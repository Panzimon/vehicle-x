Write-Host "===== Vehicle-X API Functional Tests =====" -ForegroundColor Cyan

$baseUrl = "http://localhost:3000"

# Test 1: Search cars by budget
Write-Host "`n[Test 1] Search cars - Budget 20-30w" -ForegroundColor Yellow
try {
    $body = '{"message": "I have a budget of 250000 RMB, recommend some electric SUVs"}'
    $response = Invoke-WebRequest -Uri "$baseUrl/api/chat" -Method POST -Body $body -ContentType "application/json" -UseBasicParsing
    Write-Host "✓ Search successful, StatusCode: $($response.StatusCode)" -ForegroundColor Green
} catch {
    Write-Host "✗ Search failed: $_" -ForegroundColor Red
}

# Test 2: Compare cars
Write-Host "`n[Test 2] Compare cars - BYD Han vs Li Auto L6" -ForegroundColor Yellow
try {
    $body = '{"message": "Compare BYD Han and Li Auto L6"}'
    $response = Invoke-WebRequest -Uri "$baseUrl/api/chat" -Method POST -Body $body -ContentType "application/json" -UseBasicParsing
    Write-Host "✓ Compare successful, StatusCode: $($response.StatusCode)" -ForegroundColor Green
    Write-Host "Response length: $($response.Content.Length) chars"
} catch {
    Write-Host "✗ Compare failed: $_" -ForegroundColor Red
}

# Test 3: Complex query - Search mode
Write-Host "`n[Test 3] Smart car selection - Search budget" -ForegroundColor Yellow
try {
    $body = '{"message": "Electric cars under 200000 RMB"}'
    $response = Invoke-WebRequest -Uri "$baseUrl/api/chat" -Method POST -Body $body -ContentType "application/json" -UseBasicParsing
    Write-Host "✓ Smart selection successful, StatusCode: $($response.StatusCode)" -ForegroundColor Green
} catch {
    Write-Host "✗ Smart selection failed: $_" -ForegroundColor Red
}

# Test 4: Chat mode
Write-Host "`n[Test 4] Chat mode - Simple greeting" -ForegroundColor Yellow
try {
    $body = '{"message": "Hello"}'
    $response = Invoke-WebRequest -Uri "$baseUrl/api/chat" -Method POST -Body $body -ContentType "application/json" -UseBasicParsing
    Write-Host "✓ Chat successful, StatusCode: $($response.StatusCode)" -ForegroundColor Green
} catch {
    Write-Host "✗ Chat failed: $_" -ForegroundColor Red
}

Write-Host "`n===== Tests Completed =====" -ForegroundColor Cyan