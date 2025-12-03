// combinations.js – standalone logica voor Artikelcombinaties Analyse

// Helpers die in deze pagina nodig zijn
const euro = n => n.toLocaleString('nl-NL', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 });

function computeLinearRegression(xValues, yValues) {
  const n = Math.min(xValues.length, yValues.length);
  if (n < 2) return { slope: 0, intercept: 0 };
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    const x = xValues[i];
    const y = yValues[i];
    sumX += x; sumY += y; sumXY += x * y; sumXX += x * x;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: yValues[0] || 0 };
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

// Data laden uit LocalStorage (wordt in index.html gezet na CSV upload)
let rawRows = [];
try {
  const ls = localStorage.getItem('rawRows');
  rawRows = ls ? JSON.parse(ls) : [];
} catch {}
// Fallback voor file:// context: haal data uit window.name als beschikbaar
if (!rawRows || rawRows.length === 0) {
  try {
    if (window.name) {
      const payload = JSON.parse(window.name);
      if (payload && Array.isArray(payload.rawRows)) {
        rawRows = payload.rawRows;
      }
    }
  } catch {}
}

// Variabelen voor artikelcombinaties
let selectedCombinationType = 'fixed';
let selectedArticles = [];
let combinationChartInstance = null;

// DOM elementen voor artikelcombinaties
const combinationTypeRadios = document.querySelectorAll('input[name="combinationType"]');
const mainArticleSection = document.getElementById('mainArticleSection');
let mainArticleInput = document.getElementById('mainArticleInput');
let mainArticleDropdown = document.getElementById('mainArticleDropdown');
let article1Input = document.getElementById('article1Input');
let article1Dropdown = document.getElementById('article1Dropdown');
let article2Input = document.getElementById('article2Input');
let article2Dropdown = document.getElementById('article2Dropdown');
const additionalArticles = document.getElementById('additionalArticles');
const addArticleBtn = document.getElementById('addArticleBtn');
const analyzeCombinationsBtn = document.getElementById('analyzeCombinationsBtn');
const combinationResults = document.getElementById('combinationResults');
const combinationSummary = document.getElementById('combinationSummary');
const combinationTableBody = document.getElementById('combinationTableBody');
const exportCombinationData = document.getElementById('exportCombinationData');
const exportCombinationChart = document.getElementById('exportCombinationChart');

// DOM elementen voor forecast datumfilter
const forecastDateFilterFrom = document.getElementById('forecastDateFilterFrom');
const forecastDateFilterTo = document.getElementById('forecastDateFilterTo');
const applyForecastDateFilter = document.getElementById('applyForecastDateFilter');
const clearForecastDateFilter = document.getElementById('clearForecastDateFilter');

// DOM elementen voor maand op maand groei
const monthlyGrowthIndicator = document.getElementById('monthlyGrowthIndicator');
const monthlyGrowthValue = document.getElementById('monthlyGrowthValue');
const trendDirection = document.getElementById('trendDirection');

// Variabelen voor forecast datumfilter
let forecastDateFilterFromValue = '';
let forecastDateFilterToValue = '';

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    initializeArticleCombinations();
  }, 50);

  // Optionele CSV-uploader voor standalone gebruik
  const combCsvFile = document.getElementById('combCsvFile');
  if (combCsvFile) {
    combCsvFile.addEventListener('change', e => {
      const file = e.target.files?.[0];
      if (!file) return;
      // PapaParse via global (CDN in combinations.html)
      Papa.parse(file, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        transformHeader: h => h.trim(),
        transform: v => (typeof v === 'string' ? v.trim() : v),
        complete: ({ data }) => {
          rawRows = data.filter(r => r.Artikel && r.Maand);
          try {
            localStorage.setItem('rawRows', JSON.stringify(rawRows));
            window.name = JSON.stringify({ rawRows });
          } catch {}
          // Na upload: inputs opnieuw initialiseren
          initializeSearchableInputs();
        }
      });
    });
  }
});

function initializeArticleCombinations() {
  combinationTypeRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      selectedCombinationType = e.target.value;
      updateArticleSelectionUI();
    });
  });

  addArticleBtn.addEventListener('click', addArticleField);
  analyzeCombinationsBtn.addEventListener('click', analyzeArticleCombinations);
  exportCombinationData.addEventListener('click', exportCombinationDataToExcel);
  exportCombinationChart.addEventListener('click', exportCombinationChartAsImage);

  if (applyForecastDateFilter) applyForecastDateFilter.addEventListener('click', applyForecastDateFilterHandler);
  if (clearForecastDateFilter) clearForecastDateFilter.addEventListener('click', clearForecastDateFilterHandler);

  updateArticleSelectionUI();

  if (rawRows && rawRows.length > 0) {
    initializeSearchableInputs();
  }
}

function updateArticleSelectionUI() {
  const article1Required = document.getElementById('article1Required');
  const article2Required = document.getElementById('article2Required');
  const article1Help = document.getElementById('article1Help');
  const article2Help = document.getElementById('article2Help');
  if (selectedCombinationType === 'flexible') {
    mainArticleSection.classList.remove('hidden');
    article1Required.classList.remove('hidden');
    article2Required.classList.add('hidden');
    article1Help.classList.remove('hidden');
    article2Help.classList.add('hidden');
    const article1HelpEl = document.getElementById('article1Help');
    if (article1HelpEl) article1HelpEl.textContent = 'Verplicht voor flexibele combinaties (subartikel)';
    selectedArticles = [];
    clearArticleFields();
    setTimeout(() => {
      if (rawRows && rawRows.length > 0) initializeSearchableInputs();
    }, 50);
  } else {
    mainArticleSection.classList.add('hidden');
    article1Required.classList.remove('hidden');
    article2Required.classList.remove('hidden');
    article1Help.classList.remove('hidden');
    article2Help.classList.remove('hidden');
    const article1HelpEl = document.getElementById('article1Help');
    const article2HelpEl = document.getElementById('article2Help');
    if (article1HelpEl) article1HelpEl.textContent = 'Verplicht voor vaste combinaties';
    if (article2HelpEl) article2HelpEl.textContent = 'Verplicht voor vaste combinaties';
    selectedArticles = [];
    clearArticleFields();
    setTimeout(() => {
      if (rawRows && rawRows.length > 0) initializeSearchableInputs();
    }, 50);
  }
}

function initializeSearchableInputs() {
  if (!rawRows || rawRows.length === 0) return;
  const articles = [...new Set(rawRows.map(row => row.Artikel))].filter(a => a && a.trim()).sort();
  const mainArticleInputEl = document.getElementById('mainArticleInput');
  const mainArticleDropdownEl = document.getElementById('mainArticleDropdown');
  const article1InputEl = document.getElementById('article1Input');
  const article1DropdownEl = document.getElementById('article1Dropdown');
  const article2InputEl = document.getElementById('article2Input');
  const article2DropdownEl = document.getElementById('article2Dropdown');
  const inputs = [
    { input: mainArticleInputEl, dropdown: mainArticleDropdownEl, name: 'mainArticle' },
    { input: article1InputEl, dropdown: article1DropdownEl, name: 'article1' },
    { input: article2InputEl, dropdown: article2DropdownEl, name: 'article2' }
  ];
  inputs.forEach(({ input, dropdown, name }) => {
    if (input && dropdown) {
      const oldInput = input;
      const newInput = oldInput.cloneNode(true);
      oldInput.parentNode.replaceChild(newInput, oldInput);
      newInput.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        if (searchTerm.length === 0) { dropdown.classList.add('hidden'); return; }
        const filteredArticles = articles.filter(article => article.toLowerCase().includes(searchTerm));
        showDropdown(dropdown, filteredArticles, newInput);
      });
      newInput.addEventListener('focus', () => {
        if (newInput.value.length > 0) {
          const searchTerm = newInput.value.toLowerCase();
          const filteredArticles = articles.filter(article => article.toLowerCase().includes(searchTerm));
          showDropdown(dropdown, filteredArticles, newInput);
        }
      });
      newInput.addEventListener('blur', () => { setTimeout(() => dropdown.classList.add('hidden'), 150); });
      if (name === 'mainArticle') { mainArticleInput = newInput; mainArticleDropdown = dropdown; }
      if (name === 'article1')   { article1Input = newInput;    article1Dropdown = dropdown; }
      if (name === 'article2')   { article2Input = newInput;    article2Dropdown = dropdown; }
    }
  });
}

function showDropdown(dropdown, articles, input) {
  if (articles.length === 0) { dropdown.classList.add('hidden'); return; }
  dropdown.innerHTML = articles.map(article => `
    <div class="px-3 py-2 hover:bg-gray-100 cursor-pointer border-b last:border-b-0" data-value="${article}">
      ${article}
    </div>
  `).join('');
  dropdown.querySelectorAll('[data-value]').forEach(item => {
    item.addEventListener('click', () => {
      input.value = item.dataset.value;
      dropdown.classList.add('hidden');
    });
  });
  dropdown.classList.remove('hidden');
}

function addArticleField() {
  const articleCount = additionalArticles.children.length + 3;
  const articleDiv = document.createElement('div');
  articleDiv.className = 'grid md:grid-cols-2 gap-4';
  if (!rawRows || rawRows.length === 0) { alert('Upload/ververs eerst data in de Forecast tab.'); return; }
  const articles = [...new Set(rawRows.map(row => row.Artikel))].filter(a => a && a.trim()).sort();
  const requiredMark = '<span class="text-red-500">*</span>';
  const helpText = selectedCombinationType === 'fixed' 
    ? '<p class="text-xs text-gray-500 mt-1">Verplicht voor vaste combinaties</p>'
    : '<p class="text-xs text-gray-500 mt-1">Verplicht voor flexibele combinaties (subartikel)</p>';
  articleDiv.innerHTML = `
    <div>
      <label class="block text-sm font-medium mb-2 text-gray-600">Artikel ${articleCount} ${requiredMark}</label>
      <div class="relative">
        <input type="text" class="article-input w-full px-3 py-2 border rounded-md focus:border-purple-500 focus:ring-2 focus:ring-purple-200" placeholder="Type om te zoeken...">
        <div class="article-dropdown absolute z-10 w-full mt-1 bg-white border rounded-md shadow-lg max-h-60 overflow-y-auto hidden"></div>
      </div>
      ${helpText}
    </div>
    <div class="flex items-end">
      <button class="remove-article-btn px-3 py-2 bg-red-500 text-white rounded-md hover:bg-red-600">🗑️ Verwijderen</button>
    </div>
  `;
  articleDiv.querySelector('.remove-article-btn').addEventListener('click', () => { articleDiv.remove(); });
  const input = articleDiv.querySelector('.article-input');
  const dropdown = articleDiv.querySelector('.article-dropdown');
  if (input && dropdown) {
    input.addEventListener('input', (e) => {
      const searchTerm = e.target.value.toLowerCase();
      if (searchTerm.length === 0) { dropdown.classList.add('hidden'); return; }
      const filteredArticles = articles.filter(article => article.toLowerCase().includes(searchTerm));
      showDropdown(dropdown, filteredArticles, input);
    });
    input.addEventListener('focus', () => {
      if (input.value.length > 0) {
        const searchTerm = input.value.toLowerCase();
        const filteredArticles = articles.filter(article => article.toLowerCase().includes(searchTerm));
        showDropdown(dropdown, filteredArticles, input);
      }
    });
    input.addEventListener('blur', () => { setTimeout(() => dropdown.classList.add('hidden'), 150); });
  }
  additionalArticles.appendChild(articleDiv);
}

function clearArticleFields() {
  additionalArticles.innerHTML = '';
  if (mainArticleInput) mainArticleInput.value = '';
  if (article1Input) article1Input.value = '';
  if (article2Input) article2Input.value = '';
}

function getSelectedArticles() {
  const articles = [];
  if (selectedCombinationType === 'flexible') {
    const mainArticle = mainArticleInput.value;
    if (mainArticle) articles.push(mainArticle);
    if (article1Input.value) articles.push(article1Input.value);
    if (article2Input.value) articles.push(article2Input.value);
    additionalArticles.querySelectorAll('.article-input').forEach(input => { if (input.value) articles.push(input.value); });
  } else {
    if (article1Input.value) articles.push(article1Input.value);
    if (article2Input.value) articles.push(article2Input.value);
    additionalArticles.querySelectorAll('.article-input').forEach(input => { if (input.value) articles.push(input.value); });
  }
  return articles;
}

function analyzeArticleCombinations() {
  if (!rawRows || rawRows.length === 0) { alert('Open eerst Forecast en upload CSV, of refresh na upload.'); return; }
  const articles = getSelectedArticles();
  if (articles.length < 1) { alert('Selecteer minimaal 1 artikel voor de analyse.'); return; }
  if (selectedCombinationType === 'flexible' && articles.length < 2) { alert('Selecteer minimaal 1 hoofdartikel + 1 subartikel voor flexibele combinaties.'); return; }
  if (selectedCombinationType === 'fixed' && articles.length < 2) { alert('Selecteer minimaal 2 artikelen voor vaste combinaties.'); return; }
  combinationResults.classList.remove('hidden');
  const analysis = performCombinationAnalysis(articles);
  window.currentCombinationAnalysis = analysis;
  updateCustomerDetailPeriods(analysis);
  displayCombinationResults(analysis);
  createCombinationChart(analysis);
  populateCombinationTable(analysis);
  displayMonthlyGrowth(analysis);
}

function performCombinationAnalysis(articles) {
  let filteredData = [];
  if (selectedCombinationType === 'fixed') {
    const customerMonths = new Map();
    rawRows.forEach(row => {
      if (articles.includes(row.Artikel)) {
        const monthKey = `${row.Jaar}-${String(row.Maand).padStart(2, '0')}`;
        if (forecastDateFilterFromValue && monthKey < forecastDateFilterFromValue) return;
        if (forecastDateFilterToValue && monthKey > forecastDateFilterToValue) return;
        const key = `${row['Besteld door']}-${monthKey}`;
        if (!customerMonths.has(key)) customerMonths.set(key, { articles: new Set(), total: 0, customer: row['Besteld door'], month: monthKey });
        customerMonths.get(key).articles.add(row.Artikel);
        customerMonths.get(key).total += parseFloat(row.Factuurbedrag) || 0;
      }
    });
    filteredData = Array.from(customerMonths.values())
      .filter(cm => cm.articles.size === articles.length)
      .map(cm => ({ month: cm.month, customer: cm.customer, revenue: cm.total, quantity: cm.articles.size }));
  } else {
    const mainArticle = articles[0];
    const subArticles = articles.slice(1);
    const customerMonths = new Map();
    rawRows.forEach(row => {
      if (row.Artikel === mainArticle || subArticles.includes(row.Artikel)) {
        const monthKey = `${row.Jaar}-${String(row.Maand).padStart(2, '0')}`;
        if (forecastDateFilterFromValue && monthKey < forecastDateFilterFromValue) return;
        if (forecastDateFilterToValue && monthKey > forecastDateFilterToValue) return;
        const key = `${row['Besteld door']}-${monthKey}`;
        if (!customerMonths.has(key)) customerMonths.set(key, { mainArticle: false, subArticles: new Set(), total: 0, customer: row['Besteld door'], month: monthKey });
        if (row.Artikel === mainArticle) { customerMonths.get(key).mainArticle = true; } else { customerMonths.get(key).subArticles.add(row.Artikel); }
        customerMonths.get(key).total += parseFloat(row.Factuurbedrag) || 0;
      }
    });
    filteredData = Array.from(customerMonths.values())
      .filter(cm => cm.mainArticle && cm.subArticles.size > 0)
      .map(cm => ({ month: cm.month, customer: cm.customer, revenue: cm.total, quantity: 1 + cm.subArticles.size }));
  }
  const monthlyData = new Map();
  filteredData.forEach(item => {
    if (!monthlyData.has(item.month)) monthlyData.set(item.month, { revenue: 0, quantity: 0, customers: new Set() });
    monthlyData.get(item.month).revenue += item.revenue;
    monthlyData.get(item.month).quantity += item.quantity;
    monthlyData.get(item.month).customers.add(item.customer);
  });
  const sortedData = Array.from(monthlyData.entries())
    .map(([month, data]) => ({ month, revenue: data.revenue, quantity: data.quantity, customerCount: data.customers.size }))
    .sort((a, b) => a.month.localeCompare(b.month));
  const forecast = calculateCombinationForecast(sortedData);
  return { articles, type: selectedCombinationType, historicalData: sortedData, forecast, summary: calculateCombinationSummary(sortedData, forecast) };
}

function calculateCombinationForecast(historicalData) {
  if (historicalData.length < 3) return [];
  const periods = parseInt(document.getElementById('forecastPeriod').value) || 12;
  const xValues = historicalData.map((_, i) => i);
  const yValues = historicalData.map(d => d.revenue);
  const { slope, intercept } = computeLinearRegression(xValues, yValues);
  const forecast = [];
  for (let i = 0; i < periods; i++) {
    const monthIndex = historicalData.length + i;
    const predictedRevenue = intercept + slope * monthIndex;
    const residuals = yValues.map((y, j) => y - (intercept + slope * j));
    const residualStd = Math.sqrt(residuals.reduce((sum, r) => sum + r * r, 0) / residuals.length);
    const confidenceInterval = residualStd * 1.96;
    forecast.push({ month: getNextMonth(historicalData[historicalData.length - 1].month, i + 1), revenue: Math.max(0, predictedRevenue), lowerBound: Math.max(0, predictedRevenue - confidenceInterval), upperBound: Math.max(0, predictedRevenue + confidenceInterval) });
  }
  return forecast;
}

function getNextMonth(currentMonth, offset) {
  const [year, month] = currentMonth.split('-').map(Number);
  let newMonth = month + offset;
  let newYear = year;
  while (newMonth > 12) { newMonth -= 12; newYear++; }
  return `${newYear}-${String(newMonth).padStart(2, '0')}`;
}

function calculateCombinationSummary(historicalData, forecast) {
  const totalRevenue = historicalData.reduce((sum, d) => sum + d.revenue, 0);
  const avgRevenue = totalRevenue / historicalData.length || 0;
  const totalCustomers = historicalData.reduce((sum, d) => sum + d.customerCount, 0);
  const forecastRevenue = forecast.reduce((sum, f) => sum + f.revenue, 0);
  return { totalRevenue, avgRevenue, totalCustomers, avgCustomersPerMonth: totalCustomers / historicalData.length || 0, forecastRevenue, totalPeriods: historicalData.length };
}

function displayCombinationResults(analysis) {
  const { summary } = analysis;
  combinationSummary.innerHTML = `
    <div class="text-center p-3 bg-blue-50 rounded-lg">
      <div class="text-lg font-bold text-blue-800">${euro(summary.totalRevenue)}</div>
      <div class="text-sm text-blue-600">Totale omzet</div>
    </div>
    <div class="text-center p-3 bg-green-50 rounded-lg">
      <div class="text-lg font-bold text-green-800">${euro(summary.avgRevenue)}</div>
      <div class="text-sm text-green-600">Gem. omzet/maand</div>
    </div>
    <div class="text-center p-3 bg-purple-50 rounded-lg">
      <div class="text-lg font-bold text-purple-800">${summary.totalCustomers}</div>
      <div class="text-sm text-purple-600">Totaal klanten</div>
    </div>`;
}

function displayMonthlyGrowth(analysis) {
  const { historicalData } = analysis;
  if (historicalData.length < 2) { monthlyGrowthIndicator.classList.add('hidden'); return; }
  let avgMonthlyGrowth = 0;
  let trendStartRevenue = 0;
  let trendEndRevenue = 0;
  if (historicalData.length >= 2) {
    const xValues = historicalData.map((_, index) => index);
    const yValues = historicalData.map(d => d.revenue);
    const regression = computeLinearRegression(xValues, yValues);
    trendStartRevenue = regression.intercept + (regression.slope * 0);
    trendEndRevenue = regression.intercept + (regression.slope * (historicalData.length - 1));
    if (trendStartRevenue > 0 && trendEndRevenue > 0) {
      const numberOfPeriods = historicalData.length - 1;
      const totalGrowthFactor = trendEndRevenue / trendStartRevenue;
      const monthlyGrowthFactor = Math.pow(totalGrowthFactor, 1 / numberOfPeriods);
      avgMonthlyGrowth = (monthlyGrowthFactor - 1) * 100;
    }
  }
  if (avgMonthlyGrowth === 0) {
    const monthlyGrowthRates = [];
    for (let i = 1; i < historicalData.length; i++) {
      const currentRevenue = historicalData[i].revenue;
      const previousRevenue = historicalData[i-1].revenue;
      if (previousRevenue > 0) monthlyGrowthRates.push(((currentRevenue - previousRevenue) / previousRevenue) * 100);
    }
    if (monthlyGrowthRates.length > 0) avgMonthlyGrowth = monthlyGrowthRates.reduce((sum, rate) => sum + rate, 0) / monthlyGrowthRates.length;
  }
  let trendDirectionText = '';
  let trendDirectionColor = '';
  if (avgMonthlyGrowth > 5) { trendDirectionText = 'Sterk stijgend 📈'; trendDirectionColor = 'text-green-600'; }
  else if (avgMonthlyGrowth > 1) { trendDirectionText = 'Stijgend ↗️'; trendDirectionColor = 'text-green-600'; }
  else if (avgMonthlyGrowth > -1) { trendDirectionText = 'Stabiel ➡️'; trendDirectionColor = 'text-blue-600'; }
  else if (avgMonthlyGrowth > -5) { trendDirectionText = 'Dalend ↘️'; trendDirectionColor = 'text-orange-600'; }
  else { trendDirectionText = 'Sterk dalend 📉'; trendDirectionColor = 'text-red-600'; }
  monthlyGrowthValue.textContent = `${avgMonthlyGrowth.toFixed(1)}%`;
  trendDirection.textContent = trendDirectionText;
  trendDirection.className = `ml-1 text-sm font-medium ${trendDirectionColor}`;
  const explanation = document.getElementById('monthlyGrowthExplanation');
  if (explanation) {
    if (trendStartRevenue > 0 && trendEndRevenue > 0) {
      explanation.textContent = `Gebaseerd op trendlijn: van ${euro(trendStartRevenue)} naar ${euro(trendEndRevenue)} over ${historicalData.length - 1} maand(en)`;
    } else {
      explanation.textContent = `Gebaseerd op gemiddelde van maandelijkse groeicijfers`;
    }
  }
  monthlyGrowthIndicator.classList.remove('hidden');
}

function createCombinationChart(analysis) {
  const ctx = document.getElementById('combinationChart');
  if (combinationChartInstance) { combinationChartInstance.destroy(); }
  const { historicalData, forecast } = analysis;
  const allLabels = [...historicalData.map(d => d.month), ...forecast.map(f => f.month)];
  const historicalRevenue = historicalData.map(d => d.revenue);
  const forecastRevenue = forecast.map(f => f.revenue);
  const forecastLower = forecast.map(f => f.lowerBound);
  const forecastUpper = forecast.map(f => f.upperBound);
  const datasets = [
    { label: 'Historische omzet', data: [...historicalRevenue, ...new Array(forecast.length).fill(null)], borderColor: 'rgb(59, 130, 246)', backgroundColor: 'rgba(59, 130, 246, 0.1)', type: 'bar' }
  ];
  if (document.getElementById('showForecast').checked) {
    datasets.push({ label: 'Forecast omzet', data: [...new Array(historicalData.length).fill(null), ...forecastRevenue], borderColor: 'rgb(147, 51, 234)', backgroundColor: 'rgba(147, 51, 234, 0.1)', type: 'line', borderWidth: 3 });
    datasets.push({ label: 'Confidence interval', data: [...new Array(historicalData.length).fill(null), ...forecastUpper], borderColor: 'rgba(147, 51, 234, 0.3)', backgroundColor: 'rgba(147, 51, 234, 0.1)', type: 'line', borderDash: [5, 5], fill: '+1' });
    datasets.push({ label: '', data: [...new Array(historicalData.length).fill(null), ...forecastLower], borderColor: 'rgba(147, 51, 234, 0.3)', backgroundColor: 'rgba(147, 51, 234, 0.1)', type: 'line', borderDash: [5, 5], fill: false });
  }
  if (document.getElementById('showTrendline').checked && historicalData.length >= 2) {
    const xValues = historicalData.map((_, i) => i);
    const yValues = historicalData.map(d => d.revenue);
    const { slope, intercept } = computeLinearRegression(xValues, yValues);
    const trendData = historicalData.map((_, i) => intercept + slope * i);
    datasets.push({ label: 'Trendlijn', data: [...trendData, ...new Array(forecast.length).fill(null)], borderColor: 'rgb(239, 68, 68)', backgroundColor: 'rgba(239, 68, 68, 0.1)', type: 'line', borderWidth: 2, borderDash: [3, 3] });
  }
  combinationChartInstance = new Chart(ctx, {
    type: 'bar',
    data: { labels: allLabels, datasets },
    options: { responsive: true, plugins: { tooltip: { mode: 'index', intersect: false }, legend: { position: 'bottom' } }, scales: { x: { type: 'category', title: { display: true, text: 'Periode' } }, y: { beginAtZero: true, title: { display: true, text: 'Omzet (€)' } } } }
  });
}

function populateCombinationTable(analysis) {
  const { historicalData, forecast } = analysis;
  const allData = [...historicalData.map(d => ({ ...d, type: 'historical' })), ...forecast.map(f => ({ ...f, type: 'forecast' }))];
  combinationTableBody.innerHTML = allData.map(item => `
    <tr class="border-b ${item.type === 'forecast' ? 'bg-purple-50' : ''}">
      <td class="px-3 py-2">${item.month}</td>
      <td class="px-3 py-2 text-right">${item.type === 'historical' ? `${item.quantity} artikel${item.quantity > 1 ? 'en' : ''}` : '-'}</td>
      <td class="px-3 py-2 text-right">${item.type === 'historical' ? euro(item.revenue) : '-'}</td>
      <td class="px-3 py-2 text-right">${item.type === 'forecast' ? euro(item.revenue) : '-'}</td>
      <td class="px-3 py-2 text-right">${item.type === 'forecast' ? `${euro(item.lowerBound)} - ${euro(item.upperBound)}` : '-'}</td>
    </tr>
  `).join('');
}

function exportCombinationDataToExcel() {
  alert('Excel export functionaliteit wordt geïmplementeerd...');
}

function exportCombinationChartAsImage() {
  if (combinationChartInstance) {
    const link = document.createElement('a');
    link.download = 'artikelcombinaties-grafiek.png';
    link.href = combinationChartInstance.toBase64Image();
    link.click();
  }
}

function applyForecastDateFilterHandler() {
  forecastDateFilterFromValue = forecastDateFilterFrom.value;
  forecastDateFilterToValue = forecastDateFilterTo.value;
  if (forecastDateFilterFromValue && forecastDateFilterToValue && forecastDateFilterFromValue > forecastDateFilterToValue) {
    alert('De "vanaf datum" moet voor de "tot datum" liggen.');
    return;
  }
  const articles = getSelectedArticles();
  if (articles.length > 0) {
    const analysis = performCombinationAnalysis(articles);
    window.currentCombinationAnalysis = analysis;
    updateCustomerDetailPeriods(analysis);
    displayCombinationResults(analysis);
    createCombinationChart(analysis);
    populateCombinationTable(analysis);
    displayMonthlyGrowth(analysis);
  }
}

function clearForecastDateFilterHandler() {
  forecastDateFilterFrom.value = '';
  forecastDateFilterTo.value = '';
  forecastDateFilterFromValue = '';
  forecastDateFilterToValue = '';
  const articles = getSelectedArticles();
  if (articles.length > 0) {
    const analysis = performCombinationAnalysis(articles);
    window.currentCombinationAnalysis = analysis;
    updateCustomerDetailPeriods(analysis);
    displayCombinationResults(analysis);
    createCombinationChart(analysis);
    populateCombinationTable(analysis);
    displayMonthlyGrowth(analysis);
  }
}

// Gedetailleerde klantinformatie
const customerDetailPeriod = document.getElementById('customerDetailPeriod');
const refreshCustomerDetails = document.getElementById('refreshCustomerDetails');
const customerDetailsSection = document.getElementById('customerDetailsSection');
const periodSummaryTitle = document.getElementById('periodSummaryTitle');
const totalCustomersCount = document.getElementById('totalCustomersCount');
const totalPeriodRevenue = document.getElementById('totalPeriodRevenue');
const avgRevenuePerCustomer = document.getElementById('avgRevenuePerCustomer');
const customerDetailsTableBody = document.getElementById('customerDetailsTableBody');

document.addEventListener('DOMContentLoaded', () => {
  if (refreshCustomerDetails) refreshCustomerDetails.addEventListener('click', loadCustomerDetails);
  if (customerDetailPeriod) customerDetailPeriod.addEventListener('change', loadCustomerDetails);
});

function populateCustomerDetailPeriods(historicalData) {
  if (!customerDetailPeriod) return;
  customerDetailPeriod.innerHTML = '<option value="">Kies een periode...</option>';
  if (historicalData && historicalData.length > 0) {
    historicalData.forEach(data => {
      const option = document.createElement('option');
      option.value = data.month;
      option.textContent = data.month;
      customerDetailPeriod.appendChild(option);
    });
  }
}

function loadCustomerDetails() {
  const selectedPeriod = customerDetailPeriod.value;
  if (!selectedPeriod) { customerDetailsSection.classList.add('hidden'); return; }
  const currentAnalysis = getCurrentAnalysis();
  if (!currentAnalysis) { alert('Voer eerst een artikelcombinatie analyse uit.'); return; }
  customerDetailsSection.classList.remove('hidden');
  const customerDetails = getCustomerDetailsForPeriod(selectedPeriod, currentAnalysis);
  displayCustomerDetailsSummary(selectedPeriod, customerDetails);
  populateCustomerDetailsTable(customerDetails);
}

function getCurrentAnalysis() {
  return window.currentCombinationAnalysis || null;
}

function getCustomerDetailsForPeriod(period, analysis) {
  const { articles, type, historicalData } = analysis;
  const periodData = historicalData.find(d => d.month === period);
  if (!periodData) return [];
  let periodTransactions = [];
  if (type === 'fixed') {
    const customerMonths = new Map();
    rawRows.forEach(row => {
      if (articles.includes(row.Artikel)) {
        const monthKey = `${row.Jaar}-${String(row.Maand).padStart(2, '0')}`;
        if (monthKey === period) {
          const key = `${row['Besteld door']}-${row.Artikel}`;
          if (!customerMonths.has(key)) customerMonths.set(key, { customer: row['Besteld door'], article: row.Artikel, quantity: 0, revenue: 0 });
          customerMonths.get(key).quantity += 1;
          customerMonths.get(key).revenue += parseFloat(row.Factuurbedrag) || 0;
        }
      }
    });
    const customerGroups = new Map();
    customerMonths.forEach((data) => {
      if (!customerGroups.has(data.customer)) customerGroups.set(data.customer, { customer: data.customer, articles: [], totalQuantity: 0, totalRevenue: 0 });
      const existingArticle = customerGroups.get(data.customer).articles.find(a => a.article === data.article);
      if (existingArticle) { existingArticle.quantity += data.quantity; existingArticle.revenue += data.revenue; }
      else { customerGroups.get(data.customer).articles.push({ article: data.article, quantity: data.quantity, revenue: data.revenue }); }
      customerGroups.get(data.customer).totalQuantity += data.quantity;
      customerGroups.get(data.customer).totalRevenue += data.revenue;
    });
    periodTransactions = Array.from(customerGroups.values())
      .filter(cg => cg.articles.length === articles.length)
      .map(cg => ({ customer: cg.customer, articles: cg.articles.map(a => `${a.article} (${a.quantity}x)`).join(', '), quantity: cg.totalQuantity, revenue: cg.totalRevenue, type: 'Vaste combinatie' }));
  } else {
    const mainArticle = articles[0];
    const subArticles = articles.slice(1);
    const customerMonths = new Map();
    rawRows.forEach(row => {
      if (row.Artikel === mainArticle || subArticles.includes(row.Artikel)) {
        const monthKey = `${row.Jaar}-${String(row.Maand).padStart(2, '0')}`;
        if (monthKey === period) {
          const key = `${row['Besteld door']}-${row.Artikel}`;
          if (!customerMonths.has(key)) customerMonths.set(key, { customer: row['Besteld door'], article: row.Artikel, quantity: 0, revenue: 0 });
          customerMonths.get(key).quantity += 1;
          customerMonths.get(key).revenue += parseFloat(row.Factuurbedrag) || 0;
        }
      }
    });
    const customerGroups = new Map();
    customerMonths.forEach((data) => {
      if (!customerGroups.has(data.customer)) customerGroups.set(data.customer, { customer: data.customer, mainArticle: false, subArticles: [], totalQuantity: 0, totalRevenue: 0 });
      if (data.article === mainArticle) { customerGroups.get(data.customer).mainArticle = true; }
      else {
        const existingSubArticle = customerGroups.get(data.customer).subArticles.find(a => a.article === data.article);
        if (existingSubArticle) { existingSubArticle.quantity += data.quantity; existingSubArticle.revenue += data.revenue; }
        else { customerGroups.get(data.customer).subArticles.push({ article: data.article, quantity: data.quantity, revenue: data.revenue }); }
      }
      customerGroups.get(data.customer).totalQuantity += data.quantity;
      customerGroups.get(data.customer).totalRevenue += data.revenue;
    });
    periodTransactions = Array.from(customerGroups.values())
      .filter(cg => cg.mainArticle && cg.subArticles.length > 0)
      .map(cg => {
        let mainArticleQuantity = 0;
        rawRows.forEach(row => {
          if (row.Artikel === mainArticle && row['Besteld door'] === cg.customer && `${row.Jaar}-${String(row.Maand).padStart(2, '0')}` === period) {
            mainArticleQuantity += 1;
          }
        });
        const allArticles = [{ article: mainArticle, quantity: mainArticleQuantity, revenue: 0 }, ...cg.subArticles];
        const type = `Hoofdartikel + ${cg.subArticles.length} subartikel${cg.subArticles.length > 1 ? 'en' : ''}`;
        return { customer: cg.customer, articles: allArticles.map(a => `${a.article} (${a.quantity}x)`).join(', '), quantity: cg.totalQuantity, revenue: cg.totalRevenue, type };
      });
  }
  return periodTransactions;
}

function displayCustomerDetailsSummary(period, customerDetails) {
  const totalCustomers = customerDetails.length;
  const totalRevenue = customerDetails.reduce((sum, cd) => sum + cd.revenue, 0);
  const avgRevenue = totalCustomers > 0 ? totalRevenue / totalCustomers : 0;
  periodSummaryTitle.textContent = `Periode: ${period}`;
  totalCustomersCount.textContent = totalCustomers;
  totalPeriodRevenue.textContent = euro(totalRevenue);
  avgRevenuePerCustomer.textContent = euro(avgRevenue);
}

function populateCustomerDetailsTable(customerDetails) {
  customerDetailsTableBody.innerHTML = customerDetails.map(cd => `
    <tr class="border-b hover:bg-gray-50">
      <td class="px-3 py-2 font-medium">${cd.customer}</td>
      <td class="px-3 py-2 text-sm">${cd.articles}</td>
      <td class="px-3 py-2 text-right">${cd.quantity}</td>
      <td class="px-3 py-2 text-right font-medium">${euro(cd.revenue)}</td>
      <td class="px-3 py-2 text-center">
        <span class="px-2 py-1 text-xs rounded-full ${cd.type.includes('Vaste') ? 'bg-purple-100 text-purple-800' : cd.type.includes('Hoofdartikel alleen') ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'}">${cd.type}</span>
      </td>
    </tr>
  `).join('');
}

function updateCustomerDetailPeriods(analysis) {
  if (analysis && analysis.historicalData) {
    populateCustomerDetailPeriods(analysis.historicalData);
  }
}


