"""In-memory store for async Keepa Import File builds.

Single-worker deployments (our Render setup) keep progress on the same process
that runs the build. Builds expire after one hour.
"""
from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Dict, Literal, Optional
from uuid import uuid4

BuildStatus = Literal["building", "complete", "failed"]

_TTL_SECONDS = 3600


@dataclass
class KeepaImportBuild:
    build_id: str
    user_id: str
    category: str
    status: BuildStatus
    phase: str
    completed: int
    total: int
    progress_percent: int
    message: str
    error: Optional[str] = None
    file_bytes: Optional[bytes] = None
    filename: Optional[str] = None
    created_at: float = 0.0

    def to_status_dict(self) -> dict:
        return {
            "build_id": self.build_id,
            "category": self.category,
            "status": self.status,
            "phase": self.phase,
            "completed": self.completed,
            "total": self.total,
            "progress_percent": self.progress_percent,
            "message": self.message,
            "error": self.error,
            "filename": self.filename,
        }


def _calc_progress_percent(
    phase: str,
    phase_completed: int,
    total_upcs: int,
    enrich_total: int,
) -> int:
    """Map pass-specific counts to a single 0–100 bar.

    ``phase_completed`` is progress within the current pass (main sweep or retry
    round). ``completed`` on the build record is a separate cumulative count of
    UPCs that already have product data, used only for the ``X/Y`` display.
    """
    total_upcs = max(total_upcs, 1)
    if phase == "pass1":
        return int(min(70, (phase_completed / total_upcs) * 70))
    if phase == "pass2":
        denom = max(enrich_total, 1)
        return int(70 + min(25, (phase_completed / denom) * 25))
    if phase == "excel":
        return 100
    return 0


class KeepaImportBuildStore:
    def __init__(self) -> None:
        self._builds: Dict[str, KeepaImportBuild] = {}
        self._lock = asyncio.Lock()

    def _purge_expired(self) -> None:
        cutoff = time.time() - _TTL_SECONDS
        expired = [bid for bid, b in self._builds.items() if b.created_at < cutoff]
        for bid in expired:
            del self._builds[bid]

    async def create(self, user_id: str, category: str, total_upcs: int) -> str:
        build_id = str(uuid4())
        async with self._lock:
            self._purge_expired()
            self._builds[build_id] = KeepaImportBuild(
                build_id=build_id,
                user_id=user_id,
                category=category,
                status="building",
                phase="pass1",
                completed=0,
                total=max(total_upcs, 1),
                progress_percent=0,
                message="Fetching buy-box data…",
                created_at=time.time(),
            )
        return build_id

    async def update_progress(
        self,
        build_id: str,
        *,
        phase: Optional[str] = None,
        completed: Optional[int] = None,
        phase_completed: Optional[int] = None,
        total: Optional[int] = None,
        message: Optional[str] = None,
        enrich_total: Optional[int] = None,
    ) -> None:
        async with self._lock:
            build = self._builds.get(build_id)
            if not build or build.status != "building":
                return
            if phase is not None:
                build.phase = phase
            if completed is not None:
                # Never let the displayed fetched count move backwards between
                # retry rounds (each round used to reset this to 0..N).
                build.completed = max(build.completed, completed)
            if total is not None:
                build.total = total
            if message is not None:
                build.message = message
            enrich = enrich_total if enrich_total is not None else build.total
            pct_completed = (
                phase_completed if phase_completed is not None else build.completed
            )
            new_percent = _calc_progress_percent(
                build.phase, pct_completed, build.total, enrich
            )
            if build.phase == "excel":
                build.progress_percent = new_percent
            else:
                build.progress_percent = max(build.progress_percent, new_percent)

    async def complete(self, build_id: str, file_bytes: bytes, filename: str) -> None:
        async with self._lock:
            build = self._builds.get(build_id)
            if not build:
                return
            build.status = "complete"
            build.phase = "done"
            build.completed = build.total
            build.progress_percent = 100
            build.message = "Ready to download"
            build.file_bytes = file_bytes
            build.filename = filename

    async def fail(self, build_id: str, error: str) -> None:
        async with self._lock:
            build = self._builds.get(build_id)
            if not build:
                return
            build.status = "failed"
            build.error = error
            build.message = "Build failed"

    async def get_for_user(self, build_id: str, user_id: str) -> Optional[KeepaImportBuild]:
        async with self._lock:
            self._purge_expired()
            build = self._builds.get(build_id)
            if not build or build.user_id != user_id:
                return None
            return build


keepa_import_build_store = KeepaImportBuildStore()
