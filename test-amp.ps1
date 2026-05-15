# Test Amap MCP Server
# $env:AMAP_MAPS_API_KEY="7314e7d0a6a47315e7d629fa780fe2d9"
# npx @amap/amap-maps-mcp-server

# Test Amap Direction API (Direct REST API call)
# 测试高德路线规划 API（不用 MCP，直接调 REST API）
$apiKey = "7314e7d0a6a47315e7d629fa780fe2d9"
$origin = "116.397428,39.90923"
$destination = "117.200983,39.084158"
$strategy = 0

$uri = "https://restapi.amap.com/v3/direction/driving?key=$apiKey&origin=$origin&destination=$destination&strategy=$strategy"

$result = Invoke-RestMethod -Uri $uri -Method Get

Write-Output "=== API Response ==="
Write-Output "Status: $($result.status)"
Write-Output "Info: $($result.info)"
Write-Output "Error Code: $($result.infocode)"
Write-Output ""

if ($result.status -eq "1") {
    $route = $result.route.paths[0]
    Write-Output "=== Route Info ==="
    Write-Output "Distance: $([math]::Round($route.distance / 1000, 2)) km"
    Write-Output "Duration: $([math]::Floor($route.duration / 60)) minutes"
    Write-Output "Steps: $($route.steps.Count)"
    Write-Output "Traffic Lights: $($route.traffic_lights)"
    Write-Output ""
    Write-Output "First 5 steps:"
    $route.steps | Select-Object -First 5 | ForEach-Object { Write-Output "  - $($_.instruction)" }
} else {
    Write-Output "Error: $($result.info)"
}