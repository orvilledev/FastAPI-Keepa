"""Freight Class Calculator API — NMFC density-based LTL class (authorized users)."""
import logging

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.dependencies import get_freight_class_user
from app.middleware.rate_limiter import RateLimits, limiter
from app.services.freight_class_calculator import (
    FreightClassCalculatorError,
    build_results_workbook,
    build_template_workbook,
    calculate_from_excel,
    calculate_manual,
)
from app.utils.error_handler import handle_api_errors

logger = logging.getLogger(__name__)

router = APIRouter()

_MAX_BYTES = 15 * 1024 * 1024


class ManualLineItem(BaseModel):
    pallets: int = Field(..., ge=1)
    weight: float = Field(..., gt=0)
    length: float = Field(..., gt=0)
    width: float = Field(..., gt=0)
    height: float = Field(..., gt=0)


class ManualCalculateRequest(BaseModel):
    shipment_id: str = Field(default="Manual Entry", min_length=1, max_length=120)
    skip_seventy_five_inch_rule: bool = False
    line_items: list[ManualLineItem] = Field(..., min_length=1)


class ExportRequest(BaseModel):
    """Re-export a prior JSON calculation result as Excel."""
    shipments: list[dict]
    summary: dict | None = None


def _validate_xlsx_upload(file: UploadFile) -> None:
    name = (file.filename or "").lower()
    if not (name.endswith(".xlsx") or name.endswith(".xlsm")):
        raise HTTPException(status_code=400, detail="Only .xlsx Excel files are supported.")


@router.get("/freight-class-calculator/template")
@limiter.limit(RateLimits.FILE_UPLOAD)
@handle_api_errors("download freight class template")
async def download_template(
    request: Request,
    current_user=Depends(get_freight_class_user),
):
    _ = current_user
    content = build_template_workbook()
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": 'attachment; filename="Freight Class Calculator Template.xlsx"',
        },
    )


@router.post("/freight-class-calculator/calculate-manual")
@limiter.limit(RateLimits.FILE_UPLOAD)
@handle_api_errors("calculate freight class manually")
async def calculate_manual_endpoint(
    request: Request,
    body: ManualCalculateRequest,
    current_user=Depends(get_freight_class_user),
):
    _ = current_user
    try:
        result = calculate_manual(
            [item.model_dump() for item in body.line_items],
            shipment_id=body.shipment_id.strip(),
            skip_seventy_five_inch_rule=body.skip_seventy_five_inch_rule,
        )
    except FreightClassCalculatorError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return result.to_dict()


@router.post("/freight-class-calculator/calculate-file")
@limiter.limit(RateLimits.FILE_UPLOAD)
@handle_api_errors("calculate freight class from Excel")
async def calculate_file_endpoint(
    request: Request,
    file: UploadFile = File(...),
    skip_seventy_five_inch_rule: bool = False,
    current_user=Depends(get_freight_class_user),
):
    _ = current_user
    _validate_xlsx_upload(file)

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(raw) > _MAX_BYTES:
        raise HTTPException(status_code=400, detail="File is too large (max 15 MB).")

    try:
        result = calculate_from_excel(raw, skip_seventy_five_inch_rule=skip_seventy_five_inch_rule)
    except FreightClassCalculatorError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return result.to_dict()


@router.post("/freight-class-calculator/export")
@limiter.limit(RateLimits.FILE_UPLOAD)
@handle_api_errors("export freight class results")
async def export_results_endpoint(
    request: Request,
    body: ExportRequest,
    current_user=Depends(get_freight_class_user),
):
    _ = current_user
    from app.services.freight_class_calculator import CalculationResult, ShipmentLineItem, ShipmentResult

    try:
        shipments: list[ShipmentResult] = []
        for raw in body.shipments:
            line_items = [
                ShipmentLineItem(
                    pallets=int(li["pallets"]),
                    weight_lbs=float(li["weight_lbs"]),
                    length_in=float(li["length_in"]),
                    width_in=float(li["width_in"]),
                    height_in=float(li["height_in"]),
                    adjusted_height_in=li.get("adjusted_height_in"),
                    height_rule_applied=bool(li.get("height_rule_applied")),
                    cubic_feet=float(li.get("cubic_feet", 0)),
                )
                for li in raw.get("line_items", [])
            ]
            shipments.append(
                ShipmentResult(
                    shipment_id=str(raw["shipment_id"]),
                    line_items=line_items,
                    total_weight_lbs=float(raw["total_weight_lbs"]),
                    total_cubic_feet=float(raw["total_cubic_feet"]),
                    density_pcf=float(raw["density_pcf"]),
                    freight_class=float(raw["freight_class"]),
                    height_rule_applied=bool(raw.get("height_rule_applied")),
                )
            )
        result = CalculationResult(shipments=shipments)
        xlsx = build_results_workbook(result)
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Invalid export payload.") from exc

    return Response(
        content=xlsx,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": 'attachment; filename="Freight Class Summary.xlsx"',
            "X-Freight-Shipment-Count": str(len(shipments)),
        },
    )
