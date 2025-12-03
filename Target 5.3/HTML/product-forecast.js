/* product-forecast.js – Product Forecast Tool */

// Globale state
let rawRows = [];
let selectedSupplier = '__all';
let selectedArtikelgroep = '__all';
let selectedCountry = '__all';
let productSearchQuery = '';
let baselinePeriod = 'last4weeks';
let growthRate = 0;
let forecastWeeks = 13;

// Periode definitie: vanaf 2026, 4-weken periodes startend op maandag
const PERIOD_START_DATE = new Date('2026-12-29'); // Maandag 29 december 2026
const PERIOD_LENGTH_WEEKS = 4;

// DOM elementen
const csvFile = document.getElementById('csvFile');
const supplierSelect = document.getElementById('supplierSelect');
const artikelgroepSelect = document.getElementById('artikelgroepSelect');
const countrySelect = document.getElementById('countrySelect');
const productSearch = document.getElementById('productSearch');
const baselinePeriodSelect = document.getElementById('baselinePeriod');
const growthRateInput = document.getElementById('growthRate');
const forecastWeeksInput = document.getElementById('forecastWeeks');
const forecastTableBody = document.getElementById('forecastTableBody');
const forecastTable = document.getElementById('forecastTable');
const periodInfo = document.getElementById('periodInfo');
const exportExcelBtn = document.getElementById('exportExcelBtn');
const forecastChart = document.getElementById('forecastChart');

let chart = null;

// Helper: haal land op uit row
function getCountry(row) {
  if (!row || typeof row !== 'object') return undefined;
  if (row.land != null && row.land !== '') return String(row.land).trim();
  if (row.Land != null && row.Land !== '') return String(row.Land).trim();
  const key = Object.keys(row).find(k => k.trim().toLowerCase() === 'land');
  if (key) {
    const v = row[key];
    return v == null ? undefined : String(v).trim();
  }
  return undefined;
}

// Helper: parse datum uit Maand kolom (verwacht formaat: YYYY-MM of YYYY-MM-DD)
function parseDateFromMonth(monthStr) {
  if (!monthStr) return null;
  
  // Als het al een Date object is, return direct
  if (monthStr instanceof Date) {
    return isNaN(monthStr.getTime()) ? null : monthStr;
  }
  
  // Als het een number is (timestamp), converteer naar Date
  if (typeof monthStr === 'number') {
    const date = new Date(monthStr);
    return isNaN(date.getTime()) ? null : date;
  }
  
  // Converteer naar string als het dat nog niet is
  const str = String(monthStr).trim();
  if (!str) return null;
  
  // Probeer eerst direct als Date te parsen
  const directDate = new Date(str);
  if (!isNaN(directDate.getTime())) {
    return directDate;
  }
  
  // Probeer YYYY-MM of YYYY-MM-DD formaat
  const parts = str.split('-');
  if (parts.length >= 2) {
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1; // JavaScript maanden zijn 0-indexed
    if (!isNaN(year) && !isNaN(month) && month >= 0 && month < 12) {
      return new Date(year, month, 1);
    }
  }
  
  return null;
}

// Helper: bereken welke periode een datum valt
function getPeriodForDate(date) {
  if (!date || isNaN(date.getTime())) return null;
  
  // Als datum voor 2026-12-29, return null (geen periodes voor 2026)
  if (date < PERIOD_START_DATE) return null;
  
  // Bereken aantal dagen sinds start
  const daysDiff = Math.floor((date - PERIOD_START_DATE) / (1000 * 60 * 60 * 24));
  
  // Bereken periode nummer (0-indexed)
  const periodNumber = Math.floor(daysDiff / (PERIOD_LENGTH_WEEKS * 7));
  
  // Bereken start en eind datum van deze periode
  const periodStartDays = periodNumber * PERIOD_LENGTH_WEEKS * 7;
  const periodStart = new Date(PERIOD_START_DATE);
  periodStart.setDate(periodStart.getDate() + periodStartDays);
  
  const periodEnd = new Date(periodStart);
  periodEnd.setDate(periodEnd.getDate() + (PERIOD_LENGTH_WEEKS * 7) - 1);
  
  return {
    number: periodNumber,
    start: periodStart,
    end: periodEnd,
    label: `P${periodNumber + 1} (${formatDate(periodStart)} - ${formatDate(periodEnd)})`
  };
}

// Helper: format datum
function formatDate(date) {
  if (!date || isNaN(date.getTime())) return '';
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
}

// Helper: format datum voor weergave
function formatDateShort(date) {
  if (!date || isNaN(date.getTime())) return '';
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${day}-${month}`;
}

// Genereer periodes voor forecast
function generateForecastPeriods() {
  const periods = [];
  const numPeriods = Math.ceil(forecastWeeks / PERIOD_LENGTH_WEEKS);
  
  for (let i = 0; i < numPeriods; i++) {
    const periodStart = new Date(PERIOD_START_DATE);
    periodStart.setDate(periodStart.getDate() + (i * PERIOD_LENGTH_WEEKS * 7));
    
    const periodEnd = new Date(periodStart);
    periodEnd.setDate(periodEnd.getDate() + (PERIOD_LENGTH_WEEKS * 7) - 1);
    
    periods.push({
      number: i,
      start: periodStart,
      end: periodEnd,
      label: `P${i + 1}`,
      fullLabel: `P${i + 1} (${formatDateShort(periodStart)} - ${formatDateShort(periodEnd)})`
    });
  }
  
  return periods;
}

// Parse CSV
csvFile.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  
  Papa.parse(file, {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
    transformHeader: h => h.trim(),
    transform: v => (typeof v === 'string' ? v.trim() : v),
    complete: results => {
      rawRows = results.data.filter(r => r.Artikel && (r.Maand || r.Datum));
      buildSupplierList();
      buildArtikelgroepList();
      buildCountryList();
      renderForecast();
    }
  });
});

// Build supplier dropdown
function buildSupplierList() {
  const suppliers = [...new Set(rawRows.map(r => r.Leverancier))]
    .filter(s => s != null && s !== '')
    .sort();
  
  supplierSelect.innerHTML =
    `<option value="__all">Alle leveranciers</option>` +
    suppliers.map(s => `<option value="${s}">${s}</option>`).join('');
}

// Build artikelgroep dropdown
function buildArtikelgroepList() {
  let baseRows = selectedSupplier === '__all'
    ? rawRows
    : rawRows.filter(r => r.Leverancier === selectedSupplier);
  
  const groepen = [...new Set(baseRows.map(r => r.Artikelgroep))]
    .filter(g => g != null && g !== '')
    .sort();
  
  artikelgroepSelect.innerHTML =
    `<option value="__all">Alle artikelgroepen</option>` +
    groepen.map(g => `<option value="${g}">${g}</option>`).join('');
}

// Build country dropdown
function buildCountryList() {
  let baseRows = selectedSupplier === '__all'
    ? rawRows
    : rawRows.filter(r => r.Leverancier === selectedSupplier);
  
  const landen = [...new Set(baseRows.map(getCountry))]
    .filter(l => l != null && l !== '')
    .sort();
  
  countrySelect.innerHTML =
    `<option value="__all">Alle landen</option>` +
    landen.map(l => `<option value="${l}">${l}</option>`).join('');
}

// Filter event listeners
supplierSelect.addEventListener('change', () => {
  selectedSupplier = supplierSelect.value;
  buildArtikelgroepList();
  buildCountryList();
  renderForecast();
});

artikelgroepSelect.addEventListener('change', () => {
  selectedArtikelgroep = artikelgroepSelect.value;
  renderForecast();
});

countrySelect.addEventListener('change', () => {
  selectedCountry = countrySelect.value;
  renderForecast();
});

productSearch.addEventListener('input', () => {
  productSearchQuery = productSearch.value.toLowerCase().trim();
  renderForecast();
});

baselinePeriodSelect.addEventListener('change', () => {
  baselinePeriod = baselinePeriodSelect.value;
  renderForecast();
});

growthRateInput.addEventListener('input', () => {
  growthRate = parseFloat(growthRateInput.value) || 0;
  renderForecast();
});

forecastWeeksInput.addEventListener('change', () => {
  forecastWeeks = parseInt(forecastWeeksInput.value) || 13;
  renderForecast();
});

// Bereken historische data per product
function calculateHistoricalData() {
  let filteredRows = rawRows;
  
  // Apply filters
  if (selectedSupplier !== '__all') {
    filteredRows = filteredRows.filter(r => r.Leverancier === selectedSupplier);
  }
  if (selectedArtikelgroep !== '__all') {
    filteredRows = filteredRows.filter(r => r.Artikelgroep === selectedArtikelgroep);
  }
  if (selectedCountry !== '__all') {
    filteredRows = filteredRows.filter(r => getCountry(r) === selectedCountry);
  }
  if (productSearchQuery) {
    filteredRows = filteredRows.filter(r => 
      r.Artikel && r.Artikel.toLowerCase().includes(productSearchQuery)
    );
  }
  
  // Group by product and date
  const productData = new Map(); // product -> Map(period -> quantity)
  const productHistoryByMonth = new Map(); // product -> Map(YYYY-MM -> quantity) voor historie
  
  filteredRows.forEach(row => {
    const product = row.Artikel;
    if (!product) return;
    
    // Parse date from Maand or Datum
    let date = null;
    let monthKey = null;
    
    if (row.Datum) {
      date = new Date(row.Datum);
      if (!isNaN(date.getTime())) {
        monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      }
    } else if (row.Maand) {
      date = parseDateFromMonth(row.Maand);
      if (date && !isNaN(date.getTime())) {
        // Genereer monthKey van de geparste datum
        monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        // Als row.Maand al een string is in YYYY-MM formaat, gebruik die
        if (typeof row.Maand === 'string' && /^\d{4}-\d{2}/.test(row.Maand)) {
          monthKey = row.Maand.substring(0, 7); // Neem alleen YYYY-MM deel
        }
      }
    }
    
    if (!date || isNaN(date.getTime())) return;
    
    // Get period for this date
    const period = getPeriodForDate(date);
    
    // Each row represents 1 unit (or check for quantity column)
    const quantity = row.Aantal || row.Quantity || row.Hoeveelheid || row.aantal || 1;
    const qty = typeof quantity === 'number' ? quantity : 1;
    
    if (period) {
      // Data valt in een periode (vanaf 2026)
      const key = `period_${period.number}`;
      if (!productData.has(product)) {
        productData.set(product, new Map());
      }
      const productPeriods = productData.get(product);
      const currentQty = productPeriods.get(key) || 0;
      productPeriods.set(key, currentQty + qty);
    } else {
      // Data valt voor 2026, bewaar per maand voor historie
      if (!productHistoryByMonth.has(product)) {
        productHistoryByMonth.set(product, new Map());
      }
      const historyMap = productHistoryByMonth.get(product);
      if (monthKey) {
        const currentQty = historyMap.get(monthKey) || 0;
        historyMap.set(monthKey, currentQty + qty);
      }
    }
  });
  
  // Bereken totale historie per product
  productHistoryByMonth.forEach((historyMap, product) => {
    if (!productData.has(product)) {
      productData.set(product, new Map());
    }
    const productPeriods = productData.get(product);
    const totalHistory = Array.from(historyMap.values()).reduce((a, b) => a + b, 0);
    productPeriods.set('historie', totalHistory);
  });
  
  return productData;
}

// Bereken baseline voor een product
function calculateBaseline(productPeriods) {
  // Eerst kijken of er al periodes zijn (vanaf 2026)
  const periodData = [];
  productPeriods.forEach((qty, key) => {
    if (key.startsWith('period_')) {
      const periodNum = parseInt(key.replace('period_', ''), 10);
      periodData.push({ period: periodNum, qty: qty });
    }
  });
  
  // Sorteer op periode nummer
  periodData.sort((a, b) => a.period - b.period);
  
  // Als er periodes zijn, gebruik die als baseline
  if (periodData.length > 0) {
    if (baselinePeriod === 'last4weeks') {
      // Laatste periode (4 weken)
      return periodData[periodData.length - 1].qty / PERIOD_LENGTH_WEEKS; // Per week
    } else if (baselinePeriod === 'last8weeks') {
      // Gemiddelde laatste 2 periodes
      const recent = periodData.slice(-2);
      if (recent.length > 0) {
        const totalQty = recent.reduce((sum, p) => sum + p.qty, 0);
        return totalQty / (recent.length * PERIOD_LENGTH_WEEKS); // Per week
      }
    } else if (baselinePeriod === 'last13weeks') {
      // Gemiddelde laatste 3-4 periodes (ongeveer 13 weken)
      const recent = periodData.slice(-Math.ceil(13 / PERIOD_LENGTH_WEEKS));
      if (recent.length > 0) {
        const totalQty = recent.reduce((sum, p) => sum + p.qty, 0);
        return totalQty / (recent.length * PERIOD_LENGTH_WEEKS); // Per week
      }
    } else {
      // Gemiddelde van alle periodes
      const totalQty = periodData.reduce((sum, p) => sum + p.qty, 0);
      return totalQty / (periodData.length * PERIOD_LENGTH_WEEKS); // Per week
    }
  }
  
  // Geen periodes, gebruik historie (voor 2026)
  const historyQty = productPeriods.get('historie') || 0;
  
  // Schat wekelijkse baseline uit historie (aanname: verdeel over maanden)
  // We hebben geen exacte weekdata, dus gebruiken we een schatting
  if (baselinePeriod === 'last4weeks') {
    // Schat: laatste maand / 4 weken
    return historyQty / 4; // Aanname: alle historie in laatste maand
  } else if (baselinePeriod === 'last8weeks') {
    return historyQty / 8;
  } else if (baselinePeriod === 'last13weeks') {
    return historyQty / 13;
  } else {
    // Gemiddelde: historie / aantal maanden (schatting)
    return historyQty / 12; // Aanname: verdeeld over jaar
  }
}

// Render forecast tabel
function renderForecast() {
  if (rawRows.length === 0) {
    forecastTableBody.innerHTML = `
      <tr>
        <td colspan="100" class="text-center py-8 text-gray-500">
          Upload een CSV-bestand om te beginnen
        </td>
      </tr>
    `;
    return;
  }
  
  const productData = calculateHistoricalData();
  const forecastPeriods = generateForecastPeriods();
  
  if (productData.size === 0) {
    forecastTableBody.innerHTML = `
      <tr>
        <td colspan="100" class="text-center py-8 text-gray-500">
          Geen producten gevonden met de huidige filters
        </td>
      </tr>
    `;
    return;
  }
  
  // Update period info
  if (forecastPeriods.length > 0) {
    const firstPeriod = forecastPeriods[0];
    const lastPeriod = forecastPeriods[forecastPeriods.length - 1];
    periodInfo.textContent = 
      `Toont ${forecastPeriods.length} periodes (${formatDate(firstPeriod.start)} t/m ${formatDate(lastPeriod.end)})`;
  }
  
  // Build table header
  const headerRow = forecastTable.querySelector('thead tr');
  headerRow.innerHTML = `
    <th class="border px-3 py-2 text-left sticky left-0 bg-gray-100 z-10">Product</th>
    <th class="border px-3 py-2 text-center">Historie</th>
    ${forecastPeriods.map(p => 
      `<th class="border px-3 py-2 text-center" title="${p.fullLabel}">${p.label}</th>`
    ).join('')}
  `;
  
  // Build table body
  const products = Array.from(productData.keys()).sort();
  forecastTableBody.innerHTML = products.map(product => {
    const productPeriods = productData.get(product);
    const baseline = calculateBaseline(productPeriods);
    const historyQty = productPeriods.get('historie') || 0;
    
    // Calculate forecast for each period
    const forecastCells = forecastPeriods.map((period, idx) => {
      // Baseline is per week, dus vermenigvuldig met aantal weken per periode
      const baselinePerPeriod = baseline * PERIOD_LENGTH_WEEKS;
      // Apply growth rate cumulatively
      const growthFactor = Math.pow(1 + (growthRate / 100), idx + 1);
      const forecastQty = Math.round(baselinePerPeriod * growthFactor);
      return `<td class="border px-3 py-2 text-center">${forecastQty}</td>`;
    });
    
    return `
      <tr class="hover:bg-gray-50">
        <td class="border px-3 py-2 sticky left-0 bg-white z-10 font-medium">${product}</td>
        <td class="border px-3 py-2 text-center">${historyQty}</td>
        ${forecastCells.join('')}
      </tr>
    `;
  }).join('');
  
  // Render chart
  renderChart(productData, forecastPeriods);
}

// Render chart
function renderChart(productData, forecastPeriods) {
  const products = Array.from(productData.keys()).sort();
  
  // Limit to top 10 products for readability
  const topProducts = products.slice(0, 10);
  
  const labels = ['Historie', ...forecastPeriods.map(p => p.label)];
  
  const datasets = topProducts.map((product, idx) => {
    const productPeriods = productData.get(product);
    const baseline = calculateBaseline(productPeriods);
    const historyQty = productPeriods.get('historie') || 0;
    
    const data = [historyQty];
    const baselinePerPeriod = baseline * PERIOD_LENGTH_WEEKS;
    forecastPeriods.forEach((period, pIdx) => {
      const growthFactor = Math.pow(1 + (growthRate / 100), pIdx + 1);
      const forecastQty = baselinePerPeriod * growthFactor;
      data.push(forecastQty);
    });
    
    // Generate color
    const hue = (idx * 137.508) % 360; // Golden angle for color distribution
    return {
      label: product,
      data: data,
      borderColor: `hsl(${hue}, 70%, 50%)`,
      backgroundColor: `hsla(${hue}, 70%, 50%, 0.1)`,
      tension: 0.4
    };
  });
  
  if (chart) {
    chart.destroy();
  }
  
  chart = new Chart(forecastChart, {
    type: 'line',
    data: {
      labels: labels,
      datasets: datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'right'
        },
        tooltip: {
          mode: 'index',
          intersect: false
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            precision: 0
          }
        }
      }
    }
  });
}

// Excel export
exportExcelBtn.addEventListener('click', () => {
  if (rawRows.length === 0) {
    alert('Upload eerst een CSV-bestand');
    return;
  }
  
  const productData = calculateHistoricalData();
  const forecastPeriods = generateForecastPeriods();
  const products = Array.from(productData.keys()).sort();
  
  // Prepare data for export
  const exportData = products.map(product => {
    const productPeriods = productData.get(product);
    const baseline = calculateBaseline(productPeriods);
    const historyQty = productPeriods.get('historie') || 0;
    
    const baselinePerPeriod = baseline * PERIOD_LENGTH_WEEKS;
    const row = {
      'Product': product,
      'Historie (totaal)': historyQty,
      'Baseline (per week)': Math.round(baseline * 10) / 10,
      'Baseline (per periode)': Math.round(baselinePerPeriod)
    };
    
    // Add forecast for each period
    forecastPeriods.forEach((period, idx) => {
      const growthFactor = Math.pow(1 + (growthRate / 100), idx + 1);
      const forecastQty = Math.round(baselinePerPeriod * growthFactor);
      row[`${period.label} (${formatDate(period.start)} - ${formatDate(period.end)})`] = forecastQty;
    });
    
    return row;
  });
  
  // Create workbook
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(exportData);
  
  // Set column widths
  const colWidths = [{ wch: 30 }, { wch: 15 }, { wch: 20 }];
  forecastPeriods.forEach(() => colWidths.push({ wch: 20 }));
  ws['!cols'] = colWidths;
  
  XLSX.utils.book_append_sheet(wb, ws, 'Product Forecast');
  
  // Add summary sheet
  const summaryData = [
    ['Product Forecast Export'],
    [''],
    ['Export datum:', new Date().toLocaleString('nl-NL')],
    ['Aantal producten:', products.length],
    ['Aantal periodes:', forecastPeriods.length],
    ['Groei per periode:', `${growthRate}%`],
    ['Baseline methode:', baselinePeriod],
    [''],
    ['Periode definitie:'],
    ['Start datum:', formatDate(PERIOD_START_DATE)],
    ['Periode lengte:', `${PERIOD_LENGTH_WEEKS} weken`],
    [''],
    ...forecastPeriods.map(p => [
      p.label,
      formatDate(p.start),
      formatDate(p.end)
    ])
  ];
  
  const summaryWs = XLSX.utils.aoa_to_sheet(summaryData);
  summaryWs['!cols'] = [{ wch: 20 }, { wch: 15 }, { wch: 15 }];
  XLSX.utils.book_append_sheet(wb, summaryWs, 'Info');
  
  // Download
  const fileName = `product_forecast_${new Date().toISOString().split('T')[0]}.xlsx`;
  XLSX.writeFile(wb, fileName);
});

// Initial render
renderForecast();

