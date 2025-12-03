/* market-compare.js – Batterij-marktvergelijker */

// Hard-coded SKU capaciteiten per segment (kWh)
const BATTERY_SKU_CAPACITY = {
  residential: {
    "O-G-APX-HV": 5,
    "O-G-AXE-5.0L-C1": 5,
    "O-G-ARK-2.5H-A2": 2.56,
    "O-C-5kWh-BAT-UNIT": 5.5,
    "O-E-IQBATTERY-5P-3P": 5,
    "O-E-IQBATTERY-5P-1P": 5,
    "O-H-LUNA2000-7kWh-E1": 7,
    "O-H-LUNA2000-5KWh-E0": 5,
    "O-G-NEXA2000": 2
  },
  commercial: {
    "O-G-AXE-60.0H-1HT-S1": 60
  },
  utility: {
    "O-H-LUNA2000-215-2H1": 215
  }
};

// Speciale combinatie – alleen voor residentieel
const COMBO_SKUS = {
  residential: {
    pair: ["O-C-CHGB-025-02EU-SA", "O-C-CHGB-025-02EU-BA"],
    capacity_kwh: 5.5
  }
};

const MARKET_SEGMENTS = ["Residential", "Commercial", "Utility"];

// Globale state
let rawRows = [];
let selectedCountries = ['__all'];
let marketData = {}; // { country: { year: { Residential: MWh, Commercial: MWh, Utility: MWh } } }
let trendsData = {}; // { country: { year: index } }
let volumeChart, shareChart, trendsChart, skuSalesChart;

// DOM selectors
const csvFile = document.getElementById('csvFile');
const marketCountrySelect = document.getElementById('marketCountrySelect');
const marketDataInput = document.getElementById('marketDataInput');
const marketDataControls = document.getElementById('marketDataControls');
const trendsDataInput = document.getElementById('trendsDataInput');
const trendsDataControls = document.getElementById('trendsDataControls');
const metricsCards = document.getElementById('metricsCards');
const warningsBox = document.getElementById('warningsBox');
const exportBtn = document.getElementById('exportBtn');
const skuPeriodSelect = document.getElementById('skuPeriodSelect');

// Load saved data
function loadSavedData() {
  const savedMarket = localStorage.getItem('market-data');
  const savedTrends = localStorage.getItem('trends-data');
  if (savedMarket) marketData = JSON.parse(savedMarket);
  if (savedTrends) trendsData = JSON.parse(savedTrends);
}

// Save data
function saveMarketData() {
  localStorage.setItem('market-data', JSON.stringify(marketData));
}

function saveTrendsData() {
  localStorage.setItem('trends-data', JSON.stringify(trendsData));
}

// Robust country accessor
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
      rawRows = results.data.filter(r => r.Artikel && r.Maand);
      buildCountryList();
      buildYearSelect();
      loadSavedData();
      renderAll();
    }
  });
});

// Build country dropdown
function buildCountryList() {
  const countries = [...new Set(rawRows.map(getCountry))]
    .filter(c => c != null && c !== '')
    .sort();
  
  marketCountrySelect.innerHTML = '<option value="__all">Alle landen</option>';
  countries.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    marketCountrySelect.appendChild(opt);
  });
}

// Build year dropdown for SKU analysis
function buildYearSelect() {
  const years = getAvailableYears();
  skuPeriodSelect.innerHTML = '<option value="all">Alle jaren</option>';
  years.forEach(year => {
    const opt = document.createElement('option');
    opt.value = year;
    opt.textContent = year;
    skuPeriodSelect.appendChild(opt);
  });
}

// Country selection change
marketCountrySelect.addEventListener('change', e => {
  selectedCountries = Array.from(e.target.selectedOptions).map(opt => opt.value);
  renderAll();
  renderSkuCounts(); // Update counts table
});

// Year selection change for SKU chart
skuPeriodSelect.addEventListener('change', () => {
  renderSkuSalesChart();
  renderSkuCounts();
});

// Toggle SKU counts section
document.getElementById('toggleSkuCounts').addEventListener('click', () => {
  const section = document.getElementById('skuCountsSection');
  section.classList.toggle('hidden');
  if (!section.classList.contains('hidden')) {
    renderSkuCounts();
  }
});

// Toggle unknown SKUs
document.getElementById('includeUnknownSkus').addEventListener('change', () => {
  renderSkuCounts();
});

// Toggle input panels
document.getElementById('toggleMarketInput').addEventListener('click', () => {
  marketDataInput.classList.toggle('hidden');
  if (!marketDataInput.classList.contains('hidden')) {
    renderMarketInputs();
  }
});

document.getElementById('toggleTrendsInput').addEventListener('click', () => {
  trendsDataInput.classList.toggle('hidden');
  if (!trendsDataInput.classList.contains('hidden')) {
    renderTrendsInputs();
  }
});

document.getElementById('toggleSkuOverview').addEventListener('click', () => {
  const skuOverview = document.getElementById('skuOverview');
  skuOverview.classList.toggle('hidden');
  if (!skuOverview.classList.contains('hidden')) {
    renderSkuOverview();
  }
});

// Render SKU overview
function renderSkuOverview() {
  const container = document.getElementById('skuOverviewContent');
  container.innerHTML = '';
  
  // Residential
  const residentialDiv = document.createElement('div');
  residentialDiv.className = 'border rounded p-3 bg-blue-50';
  residentialDiv.innerHTML = `
    <h4 class="font-semibold text-blue-800 mb-2">Residential</h4>
    <ul class="text-sm space-y-1">
      ${Object.entries(BATTERY_SKU_CAPACITY.residential).map(([sku, cap]) => 
        `<li class="flex justify-between">
          <span class="font-mono text-xs">${sku}</span>
          <span class="font-semibold">${cap} kWh</span>
        </li>`
      ).join('')}
      <li class="border-t pt-1 mt-1">
        <span class="text-xs text-gray-600">Combinatie:</span>
        <div class="flex justify-between">
          <span class="font-mono text-xs">O-C-CHGB-025-02EU-SA/BA</span>
          <span class="font-semibold">5.5 kWh</span>
        </div>
        <p class="text-xs text-gray-500">Beide SKU's nodig voor 1 set</p>
      </li>
    </ul>
  `;
  container.appendChild(residentialDiv);
  
  // Commercial
  const commercialDiv = document.createElement('div');
  commercialDiv.className = 'border rounded p-3 bg-green-50';
  commercialDiv.innerHTML = `
    <h4 class="font-semibold text-green-800 mb-2">Commercial</h4>
    <ul class="text-sm space-y-1">
      ${Object.entries(BATTERY_SKU_CAPACITY.commercial).map(([sku, cap]) => 
        `<li class="flex justify-between">
          <span class="font-mono text-xs">${sku}</span>
          <span class="font-semibold">${cap} kWh</span>
        </li>`
      ).join('')}
    </ul>
  `;
  container.appendChild(commercialDiv);
  
  // Utility
  const utilityDiv = document.createElement('div');
  utilityDiv.className = 'border rounded p-3 bg-purple-50';
  utilityDiv.innerHTML = `
    <h4 class="font-semibold text-purple-800 mb-2">Utility</h4>
    <ul class="text-sm space-y-1">
      ${Object.entries(BATTERY_SKU_CAPACITY.utility).map(([sku, cap]) => 
        `<li class="flex justify-between">
          <span class="font-mono text-xs">${sku}</span>
          <span class="font-semibold">${cap} kWh</span>
        </li>`
      ).join('')}
    </ul>
  `;
  container.appendChild(utilityDiv);
}

// Render market data inputs
function renderMarketInputs() {
  marketDataControls.innerHTML = '';
  
  const countries = selectedCountries.includes('__all') 
    ? [...new Set(rawRows.map(getCountry))].filter(c => c).sort()
    : selectedCountries;
  
  countries.forEach(country => {
    const countryDiv = document.createElement('div');
    countryDiv.className = 'border rounded p-3 bg-gray-50';
    countryDiv.innerHTML = `<h4 class="font-semibold mb-2">${country}</h4>`;
    
    const years = getAvailableYears();
    const table = document.createElement('table');
    table.className = 'w-full text-sm';
    
    // Header
    const headerRow = document.createElement('tr');
    headerRow.innerHTML = '<th class="text-left py-1">Jaar</th>';
    MARKET_SEGMENTS.forEach(seg => {
      headerRow.innerHTML += `<th class="text-left py-1">${seg} (MWh)</th>`;
    });
    table.appendChild(headerRow);
    
    // Data rows
    years.forEach(year => {
      const row = document.createElement('tr');
      row.innerHTML = `<td class="py-1">${year}</td>`;
      
      MARKET_SEGMENTS.forEach(seg => {
        const val = getMarketData(country, year, seg);
        row.innerHTML += `
          <td>
            <input type="number" 
                   data-country="${country}" 
                   data-year="${year}" 
                   data-segment="${seg}"
                   value="${val || ''}"
                   min="0" 
                   step="0.1"
                   class="w-full px-2 py-1 border rounded" />
          </td>
        `;
      });
      
      table.appendChild(row);
    });
    
    countryDiv.appendChild(table);
    marketDataControls.appendChild(countryDiv);
  });
  
  // Event listeners
  marketDataControls.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('change', e => {
      const country = e.target.dataset.country;
      const year = e.target.dataset.year;
      const segment = e.target.dataset.segment;
      const value = parseFloat(e.target.value) || 0;
      
      if (!marketData[country]) marketData[country] = {};
      if (!marketData[country][year]) marketData[country][year] = {};
      marketData[country][year][segment] = value;
      
      saveMarketData();
      renderAll();
    });
  });
}

// Render trends inputs
function renderTrendsInputs() {
  trendsDataControls.innerHTML = '';
  
  const countries = selectedCountries.includes('__all') 
    ? [...new Set(rawRows.map(getCountry))].filter(c => c).sort()
    : selectedCountries;
  
  countries.forEach(country => {
    const countryDiv = document.createElement('div');
    countryDiv.className = 'border rounded p-3 bg-gray-50';
    countryDiv.innerHTML = `<h4 class="font-semibold mb-2">${country}</h4>`;
    
    const years = getAvailableYears();
    const table = document.createElement('table');
    table.className = 'w-full text-sm';
    
    // Header
    const headerRow = document.createElement('tr');
    headerRow.innerHTML = '<th class="text-left py-1">Jaar</th><th class="text-left py-1">Trends Index (0-100)</th>';
    table.appendChild(headerRow);
    
    // Data rows
    years.forEach(year => {
      const row = document.createElement('tr');
      const val = getTrendsData(country, year);
      row.innerHTML = `
        <td class="py-1">${year}</td>
        <td>
          <input type="number" 
                 data-country="${country}" 
                 data-year="${year}"
                 value="${val || ''}"
                 min="0" 
                 max="100"
                 step="1"
                 class="w-full px-2 py-1 border rounded" />
        </td>
      `;
      table.appendChild(row);
    });
    
    countryDiv.appendChild(table);
    trendsDataControls.appendChild(countryDiv);
  });
  
  // Event listeners
  trendsDataControls.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('change', e => {
      const country = e.target.dataset.country;
      const year = e.target.dataset.year;
      const value = parseFloat(e.target.value) || 0;
      
      if (!trendsData[country]) trendsData[country] = {};
      trendsData[country][year] = value;
      
      saveTrendsData();
      renderAll();
    });
  });
}

// Helper functions
function getAvailableYears() {
  if (!rawRows.length) return [];
  const years = [...new Set(rawRows.map(r => r.Jaar))].filter(y => y).sort();
  return years;
}

function getMarketData(country, year, segment) {
  return marketData[country]?.[year]?.[segment] || 0;
}

function getTrendsData(country, year) {
  return trendsData[country]?.[year] || 0;
}

// Calculate our MWh from CSV
function calculateOurMWh() {
  if (!rawRows.length) return {};
  
  // Map: { year -> total MWh }
  const ourData = {};
  const years = [...new Set(rawRows.map(r => r.Jaar))].filter(y => y);
  
  years.forEach(year => {
    const yearRows = rawRows.filter(r => r.Jaar == year);
    
    // Filter by selected countries
    const filteredRows = selectedCountries.includes('__all')
      ? yearRows
      : yearRows.filter(r => {
          const country = getCountry(r);
          return selectedCountries.includes(country);
        });
    
    let totalMWh = 0;
    
    // Process each row - each row represents one unit
    filteredRows.forEach(row => {
      const artikel = row.Artikel;
      
      // Determine segment based on SKU
      let capacityKWh = 0;
      let segment = null;
      
      // Check residential
      for (const [sku, cap] of Object.entries(BATTERY_SKU_CAPACITY.residential)) {
        if (artikel === sku) {
          capacityKWh = cap;
          segment = 'residential';
          break;
        }
      }
      
      // Check commercial
      if (!segment) {
        for (const [sku, cap] of Object.entries(BATTERY_SKU_CAPACITY.commercial)) {
          if (artikel === sku) {
            capacityKWh = cap;
            segment = 'commercial';
            break;
          }
        }
      }
      
      // Check utility
      if (!segment) {
        for (const [sku, cap] of Object.entries(BATTERY_SKU_CAPACITY.utility)) {
          if (artikel === sku) {
            capacityKWh = cap;
            segment = 'utility';
            break;
          }
        }
      }
      
      // Check combo (residential) - both SKUs are needed for one complete set
      if (!segment && COMBO_SKUS.residential.pair.includes(artikel)) {
        // Track combo units separately - we'll process them at the end
        // Skip for now to avoid double counting
        return;
      }
      
      if (capacityKWh > 0) {
        totalMWh += capacityKWh / 1000;
      }
    });
    
    // Now process combo pairs
    // Group combo pairs by whether both SKUs are present
    const comboGroups = {};
    filteredRows.forEach(row => {
      const artikel = row.Artikel;
      if (COMBO_SKUS.residential.pair.includes(artikel)) {
        // Create a key based on customer and month to group combo items
        const key = `${row['Besteld door']}-${row.Jaar}-${row.Maand}`;
        if (!comboGroups[key]) {
          comboGroups[key] = { pair: [null, null] };
        }
        const idx = COMBO_SKUS.residential.pair.indexOf(artikel);
        comboGroups[key].pair[idx] = true;
      }
    });
    
    // Count complete sets (where both SKUs are present)
    let comboCount = 0;
    Object.values(comboGroups).forEach(group => {
      if (group.pair[0] && group.pair[1]) {
        comboCount++;
      }
    });
    
    // Add combo MWh
    if (comboCount > 0) {
      totalMWh += comboCount * COMBO_SKUS.residential.capacity_kwh / 1000;
    }
    
    ourData[year] = totalMWh;
  });
  
  return ourData;
}

// Calculate market totals
function calculateMarketMWh() {
  const marketTotals = {};
  const countries = selectedCountries.includes('__all') 
    ? [...new Set(rawRows.map(getCountry))].filter(c => c).sort()
    : selectedCountries;
  
  countries.forEach(country => {
    if (!marketData[country]) return;
    
    Object.keys(marketData[country]).forEach(year => {
      if (!marketTotals[year]) marketTotals[year] = 0;
      
      MARKET_SEGMENTS.forEach(seg => {
        const val = getMarketData(country, year, seg);
        marketTotals[year] += val;
      });
    });
  });
  
  return marketTotals;
}

// Render metrics cards
function renderMetricsCards() {
  const ourData = calculateOurMWh();
  const marketData = calculateMarketMWh();
  const years = getAvailableYears();
  
  if (years.length === 0) {
    metricsCards.innerHTML = '<p class="text-gray-500">Upload CSV om data te zien</p>';
    return;
  }
  
  const latestYear = years[years.length - 1];
  const prevYear = years[years.length - 2];
  
  const ourMWh = ourData[latestYear] || 0;
  const marketMWh = marketData[latestYear] || 0;
  const marketShare = marketMWh > 0 ? (ourMWh / marketMWh * 100).toFixed(2) : 0;
  
  let ourYoY = 0;
  let marketYoY = 0;
  
  if (prevYear && ourData[prevYear]) {
    ourYoY = ((ourMWh - ourData[prevYear]) / ourData[prevYear] * 100).toFixed(1);
  }
  
  if (prevYear && marketData[prevYear]) {
    marketYoY = ((marketMWh - marketData[prevYear]) / marketData[prevYear] * 100).toFixed(1);
  }
  
  metricsCards.innerHTML = `
    <div class="bg-blue-50 border border-blue-200 rounded p-4">
      <h4 class="text-sm font-semibold text-blue-800 mb-2">Onze MWh (${latestYear})</h4>
      <p class="text-2xl font-bold text-blue-900">${ourMWh.toFixed(2)}</p>
      ${prevYear ? `<p class="text-xs text-gray-600 mt-1">YoY: ${ourYoY}%</p>` : ''}
    </div>
    <div class="bg-green-50 border border-green-200 rounded p-4">
      <h4 class="text-sm font-semibold text-green-800 mb-2">Markt MWh (${latestYear})</h4>
      <p class="text-2xl font-bold text-green-900">${marketMWh.toFixed(2)}</p>
      ${prevYear ? `<p class="text-xs text-gray-600 mt-1">YoY: ${marketYoY}%</p>` : ''}
    </div>
    <div class="bg-purple-50 border border-purple-200 rounded p-4">
      <h4 class="text-sm font-semibold text-purple-800 mb-2">Marktaandeel</h4>
      <p class="text-2xl font-bold text-purple-900">${marketShare}%</p>
      <p class="text-xs text-gray-600 mt-1">vs. totale markt</p>
    </div>
    <div class="bg-orange-50 border border-orange-200 rounded p-4">
      <h4 class="text-sm font-semibold text-orange-800 mb-2">Trend</h4>
      <p class="text-2xl font-bold text-orange-900">${ourYoY > 0 ? '↑' : ourYoY < 0 ? '↓' : '→'}</p>
      <p class="text-xs text-gray-600 mt-1">vs. markt: ${(parseFloat(ourYoY) - parseFloat(marketYoY)).toFixed(1)}%</p>
    </div>
  `;
}

// Render volume chart
function renderVolumeChart() {
  const ourData = calculateOurMWh();
  const marketData = calculateMarketMWh();
  const years = getAvailableYears().sort();
  
  const ctx = document.getElementById('volumeChart').getContext('2d');
  
  if (volumeChart) volumeChart.destroy();
  
  volumeChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: years,
      datasets: [
        {
          label: 'Onze MWh',
          data: years.map(y => ourData[y] || 0),
          backgroundColor: 'rgba(31, 117, 254, 0.6)',
          borderColor: 'rgba(31, 117, 254, 1)',
          borderWidth: 1
        },
        {
          label: 'Markt MWh',
          data: years.map(y => marketData[y] || 0),
          backgroundColor: 'rgba(34, 197, 94, 0.6)',
          borderColor: 'rgba(34, 197, 94, 1)',
          borderWidth: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: function(value) {
              return value + ' MWh';
            }
          }
        }
      }
    }
  });
}

// Render share chart
function renderShareChart() {
  const ourData = calculateOurMWh();
  const marketData = calculateMarketMWh();
  const years = getAvailableYears().sort();
  
  const shares = years.map(y => {
    const m = marketData[y] || 0;
    return m > 0 ? (ourData[y] || 0) / m * 100 : 0;
  });
  
  const ctx = document.getElementById('shareChart').getContext('2d');
  
  if (shareChart) shareChart.destroy();
  
  shareChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: years,
      datasets: [{
        label: 'Marktaandeel %',
        data: shares,
        backgroundColor: 'rgba(168, 85, 247, 0.2)',
        borderColor: 'rgba(168, 85, 247, 1)',
        borderWidth: 2,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: function(value) {
              return value + '%';
            }
          }
        }
      }
    }
  });
}

// Render trends chart
function renderTrendsChart() {
  const ourData = calculateOurMWh();
  const years = getAvailableYears().sort();
  
  // Combine trends from all selected countries
  const trends = years.map(y => {
    const countries = selectedCountries.includes('__all') 
      ? [...new Set(rawRows.map(getCountry))].filter(c => c).sort()
      : selectedCountries;
    
    let maxTrend = 0;
    countries.forEach(country => {
      const trend = getTrendsData(country, y);
      if (trend > maxTrend) maxTrend = trend;
    });
    
    return maxTrend;
  });
  
  // Normalize our data to 0-100 scale
  const ourValues = years.map(y => ourData[y] || 0);
  const maxOur = Math.max(...ourValues, 1);
  const normalizedOur = ourValues.map(v => (v / maxOur) * 100);
  
  const ctx = document.getElementById('trendsChart').getContext('2d');
  
  if (trendsChart) trendsChart.destroy();
  
  trendsChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: years,
      datasets: [
        {
          label: 'Google Trends',
          data: trends,
          yAxisID: 'y',
          backgroundColor: 'rgba(251, 146, 60, 0.2)',
          borderColor: 'rgba(251, 146, 60, 1)',
          borderWidth: 2,
          fill: false
        },
        {
          label: 'Onze MWh (normalized)',
          data: normalizedOur,
          yAxisID: 'y1',
          backgroundColor: 'rgba(31, 117, 254, 0.2)',
          borderColor: 'rgba(31, 117, 254, 1)',
          borderWidth: 2,
          fill: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      scales: {
        y: {
          type: 'linear',
          display: true,
          position: 'left',
          beginAtZero: true,
          max: 100,
          ticks: {
            callback: function(value) {
              return value;
            }
          },
          title: {
            display: true,
            text: 'Trends Index'
          }
        },
        y1: {
          type: 'linear',
          display: true,
          position: 'right',
          beginAtZero: true,
          max: 100,
          grid: {
            drawOnChartArea: false
          },
          ticks: {
            callback: function(value) {
              return value.toFixed(0);
            }
          },
          title: {
            display: true,
            text: 'Onze MWh (%)'
          }
        }
      }
    }
  });
}

// Render all
function renderAll() {
  renderMetricsCards();
  renderVolumeChart();
  renderShareChart();
  renderTrendsChart();
  renderSkuSalesChart();
  renderSkuCounts();
}

// Render SKU counts table for verification
function renderSkuCounts() {
  if (!rawRows.length) return;
  
  const tbody = document.getElementById('skuCountsBody');
  if (!tbody) return;
  
  const selectedYear = skuPeriodSelect ? skuPeriodSelect.value : 'all';
  const includeUnknown = document.getElementById('includeUnknownSkus')?.checked || false;
  
  // Filter rows by year
  let filteredRows = rawRows;
  if (selectedYear !== 'all') {
    filteredRows = rawRows.filter(r => r.Jaar == selectedYear);
  }
  
  // Filter by selected countries
  if (!selectedCountries.includes('__all')) {
    filteredRows = filteredRows.filter(r => {
      const country = getCountry(r);
      return selectedCountries.includes(country);
    });
  }
  
  // Count all SKUs
  const skuCounts = {};
  const skuDetails = {};
  
  filteredRows.forEach(row => {
    const artikel = row.Artikel;
    if (!artikel) return;
    
    if (!skuCounts[artikel]) {
      skuCounts[artikel] = 0;
      skuDetails[artikel] = {
        sku: artikel,
        count: 0,
        capacity: null,
        segment: null,
        isKnown: false,
        isCombo: false
      };
    }
    
    skuCounts[artikel]++;
    skuDetails[artikel].count = skuCounts[artikel];
  });
  
  // Determine segment and capacity for known SKUs
  Object.keys(skuDetails).forEach(sku => {
    // Check residential
    for (const [knownSku, cap] of Object.entries(BATTERY_SKU_CAPACITY.residential)) {
      if (sku === knownSku) {
        skuDetails[sku].capacity = cap;
        skuDetails[sku].segment = 'Residential';
        skuDetails[sku].isKnown = true;
        return;
      }
    }
    
    // Check commercial
    for (const [knownSku, cap] of Object.entries(BATTERY_SKU_CAPACITY.commercial)) {
      if (sku === knownSku) {
        skuDetails[sku].capacity = cap;
        skuDetails[sku].segment = 'Commercial';
        skuDetails[sku].isKnown = true;
        return;
      }
    }
    
    // Check utility
    for (const [knownSku, cap] of Object.entries(BATTERY_SKU_CAPACITY.utility)) {
      if (sku === knownSku) {
        skuDetails[sku].capacity = cap;
        skuDetails[sku].segment = 'Utility';
        skuDetails[sku].isKnown = true;
        return;
      }
    }
    
    // Check combo SKUs
    if (COMBO_SKUS.residential.pair.includes(sku)) {
      skuDetails[sku].capacity = COMBO_SKUS.residential.capacity_kwh;
      skuDetails[sku].segment = 'Residential (Combo)';
      skuDetails[sku].isKnown = true;
      skuDetails[sku].isCombo = true;
    }
  });
  
  // Count combo sets separately
  const comboSets = {};
  filteredRows.forEach(row => {
    const artikel = row.Artikel;
    if (COMBO_SKUS.residential.pair.includes(artikel)) {
      const key = `${row['Besteld door']}-${row.Jaar}-${row.Maand}`;
      if (!comboSets[key]) {
        comboSets[key] = { pair: [false, false] };
      }
      const idx = COMBO_SKUS.residential.pair.indexOf(artikel);
      comboSets[key].pair[idx] = true;
    }
  });
  
  let completeComboCount = 0;
  Object.values(comboSets).forEach(group => {
    if (group.pair[0] && group.pair[1]) {
      completeComboCount++;
    }
  });
  
  // Build table rows
  let rows = [];
  
  // Known SKUs first
  Object.values(skuDetails)
    .filter(d => d.isKnown || includeUnknown)
    .sort((a, b) => {
      // Known first, then by count descending
      if (a.isKnown && !b.isKnown) return -1;
      if (!a.isKnown && b.isKnown) return 1;
      return b.count - a.count;
    })
    .forEach(detail => {
      const totalMWh = detail.capacity ? (detail.count * detail.capacity / 1000).toFixed(2) : '-';
      const status = detail.isKnown ? 
        (detail.isCombo ? 'Combo SKU' : '✅ Bekend') : 
        '❌ Onbekend';
      
      rows.push(`
        <tr class="border-b hover:bg-gray-50 ${!detail.isKnown ? 'bg-yellow-50' : ''}">
          <td class="p-2 font-mono text-xs">${detail.sku}</td>
          <td class="p-2 text-right font-semibold">${detail.count.toLocaleString('nl-NL')}</td>
          <td class="p-2 text-right">${detail.capacity ? detail.capacity : '-'}</td>
          <td class="p-2 text-right">${totalMWh}</td>
          <td class="p-2">${detail.segment || '-'}</td>
          <td class="p-2 text-xs">${status}</td>
        </tr>
      `);
    });
  
  // Add combo sets row
  if (completeComboCount > 0) {
    const comboMWh = (completeComboCount * COMBO_SKUS.residential.capacity_kwh / 1000).toFixed(2);
    rows.push(`
      <tr class="border-b hover:bg-gray-50 bg-blue-50">
        <td class="p-2 font-mono text-xs font-semibold">Combo Set (${COMBO_SKUS.residential.pair.join(' + ')})</td>
        <td class="p-2 text-right font-semibold">${completeComboCount.toLocaleString('nl-NL')}</td>
        <td class="p-2 text-right">${COMBO_SKUS.residential.capacity_kwh}</td>
        <td class="p-2 text-right">${comboMWh}</td>
        <td class="p-2">Residential (Complete Set)</td>
        <td class="p-2 text-xs">✅ Complete sets</td>
      </tr>
    `);
  }
  
  // Add summary row
  const totalKnown = Object.values(skuDetails).filter(d => d.isKnown && !d.isCombo).reduce((sum, d) => sum + d.count, 0);
  const totalUnknown = Object.values(skuDetails).filter(d => !d.isKnown).reduce((sum, d) => sum + d.count, 0);
  const totalRows = filteredRows.length;
  
  rows.push(`
    <tr class="border-t-2 border-gray-400 bg-gray-100 font-semibold">
      <td class="p-2">TOTAAL</td>
      <td class="p-2 text-right">${totalRows.toLocaleString('nl-NL')}</td>
      <td class="p-2 text-right">-</td>
      <td class="p-2 text-right">-</td>
      <td class="p-2">Bekend: ${totalKnown.toLocaleString('nl-NL')}, Onbekend: ${totalUnknown.toLocaleString('nl-NL')}</td>
      <td class="p-2 text-xs">Alle rijen</td>
    </tr>
  `);
  
  tbody.innerHTML = rows.join('');
}

// Render SKU sales pie chart
function renderSkuSalesChart() {
  if (!rawRows.length) return;
  
  const selectedYear = skuPeriodSelect.value;
  
  // Filter rows by year
  let filteredRows = rawRows;
  if (selectedYear !== 'all') {
    filteredRows = rawRows.filter(r => r.Jaar == selectedYear);
  }
  
  // Filter by selected countries
  if (!selectedCountries.includes('__all')) {
    filteredRows = filteredRows.filter(r => {
      const country = getCountry(r);
      return selectedCountries.includes(country);
    });
  }
  
  // Count SKU sales
  const skuCounts = {};
  
  filteredRows.forEach(row => {
    const artikel = row.Artikel;
    
    // Check if it's a known SKU
    let isKnownSku = false;
    
    // Check all segments
    for (const segment in BATTERY_SKU_CAPACITY) {
      for (const sku in BATTERY_SKU_CAPACITY[segment]) {
        if (artikel === sku) {
          isKnownSku = true;
          break;
        }
      }
      if (isKnownSku) break;
    }
    
    // Check combo SKUs
    if (!isKnownSku && COMBO_SKUS.residential.pair.includes(artikel)) {
      isKnownSku = true;
    }
    
    if (isKnownSku) {
      skuCounts[artikel] = (skuCounts[artikel] || 0) + 1;
    }
  });
  
  // Sort by count descending
  const sortedSkus = Object.entries(skuCounts)
    .sort((a, b) => b[1] - a[1]);
  
  if (sortedSkus.length === 0) {
    // Clear chart if no data
    const ctx = document.getElementById('skuSalesChart');
    if (ctx) {
      ctx.innerHTML = '';
    }
    return;
  }
  
  // Generate colors
  const colors = [
    'rgba(31, 117, 254, 0.8)',    // Blue
    'rgba(34, 197, 94, 0.8)',     // Green
    'rgba(168, 85, 247, 0.8)',    // Purple
    'rgba(251, 146, 60, 0.8)',    // Orange
    'rgba(239, 68, 68, 0.8)',     // Red
    'rgba(59, 130, 246, 0.8)',    // Light Blue
    'rgba(16, 185, 129, 0.8)',    // Teal
    'rgba(139, 92, 246, 0.8)',    // Violet
    'rgba(245, 158, 11, 0.8)',    // Amber
    'rgba(236, 72, 153, 0.8)',    // Pink
  ];
  
  const datasetColors = sortedSkus.map((_, idx) => colors[idx % colors.length]);
  
  const ctx = document.getElementById('skuSalesChart');
  if (!ctx) return;
  
  const chartCtx = ctx.getContext('2d');
  
  if (skuSalesChart) skuSalesChart.destroy();
  
  skuSalesChart = new Chart(chartCtx, {
    type: 'pie',
    data: {
      labels: sortedSkus.map(([sku]) => sku),
      datasets: [{
        data: sortedSkus.map(([_, count]) => count),
        backgroundColor: datasetColors,
        borderColor: datasetColors.map(c => c.replace('0.8', '1')),
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          position: 'right',
          labels: {
            font: {
              size: 11
            }
          }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const label = context.label || '';
              const value = context.parsed || 0;
              const total = context.dataset.data.reduce((a, b) => a + b, 0);
              const percentage = ((value / total) * 100).toFixed(1);
              return `${label}: ${value} (${percentage}%)`;
            }
          }
        }
      }
    }
  });
}

// Export CSV
exportBtn.addEventListener('click', () => {
  const ourData = calculateOurMWh();
  const marketData = calculateMarketMWh();
  const years = getAvailableYears().sort();
  
  const rows = [];
  rows.push(['Jaar', 'Onze MWh', 'Markt MWh', 'Marktaandeel %', 'YoY Onze %', 'YoY Markt %']);
  
  years.forEach((year, idx) => {
    const our = ourData[year] || 0;
    const market = marketData[year] || 0;
    const share = market > 0 ? (our / market * 100).toFixed(2) : 0;
    
    let ourYoY = '';
    let marketYoY = '';
    
    if (idx > 0 && ourData[years[idx-1]]) {
      ourYoY = ((our - ourData[years[idx-1]]) / ourData[years[idx-1]] * 100).toFixed(1);
    }
    
    if (idx > 0 && marketData[years[idx-1]]) {
      marketYoY = ((market - marketData[years[idx-1]]) / marketData[years[idx-1]] * 100).toFixed(1);
    }
    
    rows.push([year, our.toFixed(2), market.toFixed(2), share, ourYoY, marketYoY]);
  });
  
  const csv = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'marktaantanalyse.csv';
  a.click();
});

// Initialize
loadSavedData();

