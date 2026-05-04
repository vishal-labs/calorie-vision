import pytest
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

class TestBarcodeScannerIntegration:
    def test_barcode_ui_elements_in_html(self):
        """Verify that the barcode scanner UI containers exist in the index.html."""
        response = client.get("/")
        assert response.status_code == 200
        html = response.text
        
        # Check buttons and containers
        assert 'id="btn-barcode"' in html
        assert 'id="view-barcode"' in html
        assert 'id="view-barcode-result"' in html
        assert 'id="barcode-video"' in html
        
        # Check ZXing script inclusion
        assert 'unpkg.com/@zxing/library@latest' in html

    def test_barcode_logic_in_js(self):
        """Verify that barcode and Nutri-Score mapping logic exists in app.js."""
        # Find the JS file path from HTML
        response = client.get("/")
        js_path = None
        for line in response.text.split("\n"):
            if "script src=" in line and "app.js" in line:
                # Extract e.g. /static/app.js?v=6 -> /static/app.js
                raw_path = line.split('src="')[1].split('"')[0]
                js_path = raw_path.split("?")[0]
                break
                
        assert js_path is not None, "Could not find app.js in index.html"
        
        # Fetch the JS file
        js_response = client.get(js_path)
        assert js_response.status_code == 200
        js_content = js_response.text
        
        # Assert logic features
        assert 'handleBarcodeScan' in js_content
        assert 'startBarcodeScanner' in js_content
        assert 'nutriScoreDescriptions' in js_content
        assert 'ns-square' in js_content
        
        # Verify Nutri-Score grades exist in the descriptions object
        for grade in ['a', 'b', 'c', 'd', 'e']:
            assert f"'{grade}':" in js_content or f'"{grade}":' in js_content or f"{grade}:" in js_content

    def test_barcode_css_classes(self):
        """Verify that Nutri-Score CSS classes exist in style.css."""
        # Fetch the CSS file
        css_response = client.get("/static/style.css")
        assert css_response.status_code == 200
        css_content = css_response.text
        
        # Verify barcode specific CSS
        assert '.scanner-overlay' in css_content
        assert '.scanner-box' in css_content
        
        # Verify Nutri-Score badge classes
        assert '.ns-square' in css_content
        assert '.ns-section' in css_content
        for grade in ['a', 'b', 'c', 'd', 'e']:
            assert f'.ns-{grade}' in css_content
