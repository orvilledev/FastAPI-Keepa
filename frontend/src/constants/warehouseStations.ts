/** Floor station logins that share Warehouse1's access. Keep in sync with backend warehouse_stations.py. */
export const FLOOR_STATION_EMAILS = [
  'warehouse1@metroshoewarehouse.com',
  ...Array.from({ length: 8 }, (_, index) => `label${index + 1}@metroshoewarehouse.com`),
  ...Array.from({ length: 6 }, (_, index) => `pack${index + 1}@metroshoewarehouse.com`),
] as const
