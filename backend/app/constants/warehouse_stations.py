"""Floor station logins that share Warehouse1's access."""

FLOOR_STATION_EMAILS = (
    "warehouse1@metroshoewarehouse.com",
    *(f"label{n}@metroshoewarehouse.com" for n in range(1, 9)),
    *(f"pack{n}@metroshoewarehouse.com" for n in range(1, 7)),
)
