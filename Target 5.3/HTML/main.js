/* main.js – stap 1: upload → omzet per maand → chart */
import { groupBy, sumBy } from './utils.js'; // kleine helper (komt zo)

// Euro-format helper
const euro = n => n.toLocaleString('nl-NL',
  { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 });

// Lineaire regressie (least squares) helper
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

  /* ---------- KPI defaults ---------- */
const kpis = {
  churn:        5,   // %
  newBiz:       5,   // %
  growth:       5,   // %
  dipDec:       5,   // %
  dipBouwvak:   5,   // %
};

/* ---- Event-klant settings ---- */
const eventSettings = new Map();      // klant → { growth: 0, stop: '' }

/* ---- Individuele klant settings ---- */
const individualCustomerSettings = new Map(); // klant → { growth: 0, changeMonth: '', changePct: 0, skipMonths: [] }

/* ---- Baseline-opties ---- */
let baselineMode   = 'single';        // 'single' | 'range'
let baselineMonth  = '';              // 'YYYY-MM'
let baselineFrom   = '';
let baselineTo     = '';
let forecastMode   = 'kpi';           // 'kpi' | 'trend' | 'exp'  // ▼ nieuw
let useSeasonality = false;            // ▼ nieuw
let customerMode   = 'percent';        // 'percent' | 'absolute'  // ▼ nieuw
let newCustomersPerMonth = 0;          // ▼ nieuw
let onboardingCurve = 1;               // 0.5..2 (sneller langzamer) ▼ nieuw
let avgRevenuePerCustomerAbs = 0;      // ▼ nieuw
let avgRevenuePerCustomerManual = 0;    // ▼ nieuw - gem. omzet per klant voor manual mode
let manualCustomerPlan = new Map();    // ▼ nieuw
let manualPlanMonths = [];             // ▼ nieuw
let manualPlanBaseline = 0;            // ▼ nieuw
let manualInputDebounceTimer = null;   // ▼ nieuw - debounce timer voor input
let lastExportPayload = null;          // ▼ nieuw
const LOCAL_CONFIG_KEY = 'merktarget:dashboard-config'; // ▼ oud - voor backward compatibility
const CONFIGS_STORAGE_KEY = 'merktarget:configs'; // ▼ nieuw - voor meerdere configuraties
const scenarioColors = ['#2563eb', '#d97706', '#16a34a', '#7c3aed', '#dc2626', '#0891b2', '#f97316', '#0f766e'];
const scenarios = [];
let lastScenarioCapture = null;
// Uitbreiding forecast/targets naar extra jaren
let showExtraYears = false;            // wanneer true: forecast en targets t/m +3 jaar
let forecastMonths = 18;               // dynamische horizon i.p.v. vast 18
let showTrendline = true;              // control voor zichtbaarheid trendlijn
let showMarketGrowth = false;           // control voor zichtbaarheid marktgroei
let marketGrowthRate = 2;               // marktgroei percentage per maand
let revenueGrouping = 'month';         // 'month' | 'quarter' | 'year'
// Maandfactor-overrides: 12 waarden, factor (1.0 = 100%), of null = auto
let seasonalityOverrides = Array(12).fill(null);
// Track of er handmatige overrides zijn ingesteld
let hasManualSeasonalityOverrides = false;
const STORAGE_SEASONALITY_PRESET = [69, 72, 123, 141, 105, 117, 95, 81, 96, 100, 100, 70];
let lastSeasonalityBaseFactors = Array(12).fill(1);

// ---------- Seizoensindex helpers & UI (top-level) ----------
const monthNamesNl = ['Jan','Feb','Mrt','Apr','Mei','Jun','Jul','Aug','Sep','Okt','Nov','Dec'];

function computeSeasonalityFactors(historyMonthly) {
  // historyMonthly: Map('YYYY-MM' -> {normal, event, eventPerClient})
  // ⚠️ Let op: we gebruiken ALLEEN 'normal' + event-klanten die expliciet zijn aangevinkt
  const factors = Array(12).fill(1);
  if (!historyMonthly || historyMonthly.size === 0) return factors;
  const sums = Array(12).fill(0);
  const counts = Array(12).fill(0);
  historyMonthly.forEach((v, key) => {
    const [, mmStr] = key.split('-');
    const mIdx = Number(mmStr) - 1;
    let total = v.normal; // Start met normale klanten
    
    // Voeg event-klanten toe die zijn aangevinkt voor seizoensindex
    if (v.eventPerClient) {
      v.eventPerClient.forEach((omzet, klant) => {
        const cfg = eventSettings.get(klant);
        // Skip uitgesloten klanten en tel alleen mee als includeInSeasonality aan staat
        if (cfg && cfg.excludeFromTarget) return;
        if (cfg && cfg.includeInSeasonality) {
          total += omzet;
        }
      });
    }
    
    if (total > 0) { // tel alleen mee als er omzet is
      sums[mIdx] += total;
      counts[mIdx] += 1;
    }
  });
  const avgs = sums.map((s, i) => counts[i] ? s / counts[i] : 0);
  const nonZero = avgs.filter(a => a > 0);
  const overall = nonZero.length ? (nonZero.reduce((sum, a) => sum + a, 0) / nonZero.length) : 0;
  if (overall > 0) {
    for (let i = 0; i < 12; i++) factors[i] = avgs[i] > 0 ? (avgs[i] / overall) : 1;
  }
  return factors;
}

function renderSeasonalityInputs(baseFactors) {
  const box = document.getElementById('seasonalityBox');
  const container = document.getElementById('seasonalityInputs');
  if (!box || !container) return;
  if (Array.isArray(baseFactors) && baseFactors.length === 12) {
    lastSeasonalityBaseFactors = baseFactors.slice();
  }
  
  
  // Toon box als seasonality aan staat
  box.classList.toggle('hidden', !(useSeasonality && forecastMode === 'kpi'));

  if (box.classList.contains('hidden')) return;

  container.innerHTML = '';
  for (let i = 0; i < 12; i++) {
    const label = monthNamesNl[i];
    const overrideFactor = seasonalityOverrides[i];
    const autoFactor = baseFactors[i] ?? 1;
    
    
    // Behoud handmatige overrides, gebruik auto alleen als er geen override is
    let valuePct;
    if (overrideFactor !== null && overrideFactor !== undefined) {
      valuePct = Math.round(100 * overrideFactor);
    } else {
      // Als er geen override is, gebruik de automatische factor
      valuePct = Math.round(100 * autoFactor);
    }
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <label class="block text-xs font-medium mb-1">${label}</label>
      <div class="flex items-center gap-2">
        <input type="text" data-month-idx="${i}" value="${valuePct}"
               class="w-20 px-2 py-1 border rounded" placeholder="100" />
        <span class="text-xs text-gray-500">%</span>
        <button class="text-xs text-blue-600 underline" data-reset-idx="${i}">Auto</button>
      </div>
    `;
    container.appendChild(wrap);
  }

  // Input handlers - verbeterd voor directe input
  container.querySelectorAll('input[data-month-idx]').forEach(inp => {
    inp.addEventListener('input', e => {
      const idx = Number(e.target.dataset.monthIdx);
      const inputValue = e.target.value.trim();
      
      
      // Alleen valideren als er een geldige waarde is ingevoerd
      if (inputValue && !isNaN(inputValue)) {
        let pct = Number(inputValue);
        if (isFinite(pct) && pct > 0) {
          // Sla de waarde op zonder directe validatie tijdens het typen
          seasonalityOverrides[idx] = pct / 100; // als factor opslaan
          hasManualSeasonalityOverrides = true; // Markeer als handmatig aangepast
          // Geen automatische grafiek update meer - alleen bij button klik
        }
      }
    });
    
    // Voeg event listener toe voor directe input
    inp.addEventListener('keydown', e => {
      // Sta alle toetsen toe - geen beperkingen meer
      // Alleen Enter om te valideren
      if (e.key === 'Enter') {
        e.preventDefault();
        e.target.blur(); // Trigger blur event voor validatie
      }
    });
    
    // Valideer waarde wanneer veld wordt verlaten
    inp.addEventListener('blur', e => {
      const idx = Number(e.target.dataset.monthIdx);
      const inputValue = e.target.value.trim();
      let pct = Number(inputValue);
      
      
      if (!inputValue || isNaN(pct) || pct <= 0) {
        // Herstel naar vorige waarde of 100%
        const overrideFactor = seasonalityOverrides[idx];
        const autoFactor = baseFactors[idx] ?? 1;
        pct = Math.round(100 * (overrideFactor != null ? overrideFactor : autoFactor));
        e.target.value = pct;
      } else {
        // Valideer bereik en update (geen minimum van 10% meer)
        pct = Math.max(1, Math.min(300, pct));
        e.target.value = pct;
        seasonalityOverrides[idx] = pct / 100;
        hasManualSeasonalityOverrides = true;
        // Geen automatische grafiek update meer - alleen bij button klik
      }
    });
  });
  
  // Update grafiek button
  const updateChartBtn = document.getElementById('updateSeasonalityChartBtn');
  if (updateChartBtn) {
    updateChartBtn.onclick = () => {
      renderChart();
    };
  }
  
  // Reset naar auto
  container.querySelectorAll('button[data-reset-idx]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      const idx = Number(btn.dataset.resetIdx);
      seasonalityOverrides[idx] = null;
      // Check of er nog handmatige overrides zijn
      hasManualSeasonalityOverrides = seasonalityOverrides.some(f => f != null);
      // Geen automatische grafiek update meer - alleen bij button klik
    });
  });
}

// Toggle editor zichtbaar
const seasonalityToggleBtn = document.getElementById('toggleSeasonalityEditor');
const seasonalityEditor = document.getElementById('seasonalityEditor');
if (seasonalityToggleBtn && seasonalityEditor) {
  seasonalityToggleBtn.addEventListener('click', () => {
    seasonalityEditor.classList.toggle('hidden');
  });
}




  // suppliers dropdown opbouwen
function buildSupplierList() {
  const suppliers = [...new Set([
    ...rawRows.map(r => r.Leverancier),
    ...newSuppliers.map(ns => ns.name),
  ])].sort();  supplierSelect.innerHTML =
    `<option value="__all">Alle leveranciers</option>` +
    suppliers.map(s => `<option value="${s}">${s}</option>`).join('');
}

// laad / init Set met event-klanten voor huidige supplier
function loadEventSet() {
  if (!eventCustomersMap.has(selectedSupplier)) {
    eventCustomersMap.set(selectedSupplier, new Set());
  }
  eventCustomers = eventCustomersMap.get(selectedSupplier);
}


const fileInput      = document.getElementById('csvFile');
const customerSearch = document.getElementById('customerSearch');
const customerList   = document.getElementById('customerList');
const ctx            = document.getElementById('revenueChart');
const yearTargetBox  = document.getElementById('yearTarget');
const avgRevenueBox  = document.getElementById('avgRevenuePerNormalCustomer');
const supplierSelect  = document.getElementById('supplierSelect');
const artikelgroepSelect = document.getElementById('artikelgroepSelect'); // ▼ nieuw
const countrySelect = document.getElementById('countrySelect');           // ▼ nieuw
const customerSelect = document.getElementById('customerSelect');         // ▼ nieuw
const segmentSelect = document.getElementById('segmentSelect');            // ▼ nieuw C&I/Residentieel
const trendlineToggle = document.getElementById('toggleTrendline');
if (trendlineToggle) {
  showTrendline = trendlineToggle.checked;
}
const storagePresetBtn = document.getElementById('applyStorageSeasonalityPreset');
if (storagePresetBtn) {
  storagePresetBtn.addEventListener('click', () => {
    seasonalityOverrides = STORAGE_SEASONALITY_PRESET.map(v => v / 100);
    hasManualSeasonalityOverrides = true;
    renderSeasonalityInputs(lastSeasonalityBaseFactors);
    renderChart();
  });
}
const stackedBarsToggle = document.getElementById('toggleStackedBars');
let showStackedBars = stackedBarsToggle ? stackedBarsToggle.checked : true;
const revenueGroupingSelect = document.getElementById('revenueGrouping');
const manualCustomerContainer = document.getElementById('manualCustomerConfig'); // ▼ nieuw
const manualCustomerInputs = document.getElementById('manualCustomerInputs');     // ▼ nieuw
const manualCustomerClearBtn = document.getElementById('manualCustomerClearBtn'); // ▼ nieuw
const exportExcelBtn = document.getElementById('exportExcelBtn');                 // ▼ nieuw
const scenarioNameInput = document.getElementById('scenarioNameInput');           // ▼ nieuw
const scenarioSaveBtn = document.getElementById('scenarioSaveBtn');               // ▼ nieuw
const scenarioList = document.getElementById('scenarioList');                     // ▼ nieuw
const saveLocalConfigBtn = document.getElementById('saveLocalConfigBtn');         // ▼ nieuw
const loadLocalConfigBtn = document.getElementById('loadLocalConfigBtn');         // ▼ nieuw
if (manualCustomerClearBtn) {
  manualCustomerClearBtn.addEventListener('click', () => {
    manualCustomerPlan.clear();
    renderManualCustomerConfig(manualPlanMonths, manualPlanBaseline);
    renderChart();
  });
}
if (exportExcelBtn) {
  exportExcelBtn.addEventListener('click', () => {
    exportDashboardToCsv();
  });
}
if (stackedBarsToggle) {
  stackedBarsToggle.addEventListener('change', () => {
    showStackedBars = stackedBarsToggle.checked;
    renderChart();
  });
}
if (revenueGroupingSelect) {
  revenueGrouping = revenueGroupingSelect.value || 'month';
  revenueGroupingSelect.addEventListener('change', () => {
    revenueGrouping = revenueGroupingSelect.value || 'month';
    renderChart();
  });
}
if (scenarioSaveBtn) {
  scenarioSaveBtn.addEventListener('click', () => {
    saveScenario();
  });
}
if (scenarioList && !scenarioList.dataset.bound) {
  scenarioList.addEventListener('change', (e) => {
    if (e.target.classList.contains('scenario-visible')) {
      const wrap = e.target.closest('[data-scenario-id]');
      if (!wrap) return;
      const id = Number(wrap.dataset.scenarioId);
      const scenario = scenarios.find(s => s.id === id);
      if (scenario) {
        scenario.visible = e.target.checked;
        renderChart();
      }
    }
  });
  scenarioList.addEventListener('click', (e) => {
    const wrap = e.target.closest('[data-scenario-id]');
    if (!wrap) return;
    const id = Number(wrap.dataset.scenarioId);
    const scenario = scenarios.find(s => s.id === id);
    if (!scenario) return;

    if (e.target.classList.contains('scenario-load')) {
      try {
        safeLoadSnapshot(scenario.snapshot);
        renderChart();
      } catch (err) {
        alert('Scenario kon niet worden geladen. Controleer of het scenario-bestand nog geldig is.');
      }
    }
    if (e.target.classList.contains('scenario-delete')) {
      const idx = scenarios.findIndex(s => s.id === id);
      if (idx !== -1) {
        scenarios.splice(idx, 1);
        renderScenarioList();
        renderChart();
      }
    }
  });
  scenarioList.dataset.bound = '1';
}
if (saveLocalConfigBtn) {
  saveLocalConfigBtn.addEventListener('click', () => {
    const snapshot = safeMakeSnapshot();
    if (!snapshot) return;
    try {
      localStorage.setItem(LOCAL_CONFIG_KEY, JSON.stringify(snapshot));
      alert('Instellingen zijn lokaal opgeslagen.');
    } catch (err) {
      console.error('Opslaan in localStorage mislukt', err);
      alert('Opslaan in local storage is mislukt. Mogelijk is er onvoldoende ruimte of is opslag geblokkeerd.');
    } finally {
      updateLocalConfigButtons();
    }
  });
}
if (loadLocalConfigBtn) {
  loadLocalConfigBtn.addEventListener('click', () => {
    try {
      const raw = localStorage.getItem(LOCAL_CONFIG_KEY);
      if (!raw) {
        alert('Geen lokale instellingen gevonden.');
        return;
      }
      const parsed = JSON.parse(raw);
      safeLoadSnapshot(parsed);
      alert('Lokale instellingen geladen.');
    } catch (err) {
      console.error('Laden uit localStorage mislukt', err);
      alert('Het laden van lokale instellingen is mislukt. Het opgeslagen bestand lijkt ongeldig.');
    } finally {
      updateLocalConfigButtons();
    }
  });
  updateLocalConfigButtons();
}
renderScenarioList();

let selectedSupplier   = '__all';                 // huidige filter
let selectedArtikelgroep = '__all';               // ▼ nieuw
let selectedCountry = '__all';                    // ▼ nieuw
let selectedCustomer = '__all';                   // ▼ nieuw
let selectedSegment = '__all';                    // ▼ nieuw: '__all' | 'residentieel' | 'ci'
const ciArtikelen = new Set();                   // ▼ nieuw: Set met artikelen gemarkeerd als C&I
const eventCustomersMap = new Map();              // { supplier → Set() }
let eventCustomers      = new Set();              // alias naar map-entry

// Datumfilter variabelen
let dateFilterFrom = '';                          // 'YYYY-MM' of leeg
let dateFilterTo = '';                            // 'YYYY-MM' of leeg

let rawRows       = [];   // alle transacties

// Helper: check of artikel C&I is
function isCiArtikel(artikel) {
  return ciArtikelen.has(artikel);
}

// C&I markering lijst opbouwen (toont alle unieke artikelen)
let allCiArtikelen = []; // Houd alle artikelen bij voor zoekfunctie

function buildCiMarkingList() {
  let baseRows = selectedSupplier === '__all'
    ? rawRows
    : rawRows.filter(r => r.Leverancier === selectedSupplier);
  
  // Optioneel: filter op artikelgroep als die geselecteerd is
  if (selectedArtikelgroep !== '__all') {
    baseRows = baseRows.filter(r => r.Artikelgroep === selectedArtikelgroep);
  }
  
  allCiArtikelen = [...new Set(baseRows.map(r => r.Artikel))]
    .filter(a => a != null && a !== '')
    .sort();
  
  const listEl = document.getElementById('ciMarkingList');
  if (allCiArtikelen.length === 0) {
    listEl.innerHTML = '<p class="text-sm text-gray-500">Upload eerst een CSV om artikelen te zien</p>';
    if (ciSearchInput) ciSearchInput.value = '';
    return;
  }
  
  // Reset zoekveld bij nieuwe lijst
  if (ciSearchInput) ciSearchInput.value = '';
  renderCiMarkingList();
}

// Render C&I lijst met zoekfilter
function renderCiMarkingList(searchQuery = '') {
  const listEl = document.getElementById('ciMarkingList');
  const countEl = document.getElementById('ciSearchResultsCount');
  
  const query = searchQuery.toLowerCase().trim();
  const filtered = query 
    ? allCiArtikelen.filter(a => a.toLowerCase().includes(query))
    : allCiArtikelen;
  
  listEl.innerHTML = filtered.map(a => {
    // Voeg highlight toe voor zoekresultaten
    const displayName = query 
      ? highlightMatch(a, query)
      : a;
    return `
    <label class="flex items-center gap-2 text-sm ci-marking-label" data-artikel="${a}">
      <input type="checkbox" data-artikel="${a}" class="ci-marking-chk" 
             ${ciArtikelen.has(a) ? 'checked' : ''} />
      <span>${displayName}</span>
    </label>
  `;
  }).join('');
  
  // Update result count
  if (countEl) {
    countEl.textContent = query 
      ? `${filtered.length} van ${allCiArtikelen.length} artikelen getoond`
      : `${allCiArtikelen.length} artikelen`;
  }
  
  // Event listeners voor checkboxes
  listEl.querySelectorAll('.ci-marking-chk').forEach(chk => {
    chk.addEventListener('change', (e) => {
      const artikel = e.target.dataset.artikel;
      if (e.target.checked) {
        ciArtikelen.add(artikel);
      } else {
        ciArtikelen.delete(artikel);
      }
      // Herrender grafieken bij wijziging
      buildCustomerList();
      renderChart();
    });
  });
}

// Helper om matches te highlighten (optioneel)
function highlightMatch(text, query) {
  if (!query) return text;
  const index = text.toLowerCase().indexOf(query);
  if (index === -1) return text;
  const before = text.substring(0, index);
  const match = text.substring(index, index + query.length);
  const after = text.substring(index + query.length);
  return `${before}<mark class="bg-yellow-200">${match}</mark>${after}`;
}

// Artikelgroep dropdown opbouwen (gebaseerd op huidige supplier)
function buildArtikelgroepList() {                 // ▼ nieuw
  let baseRows = selectedSupplier === '__all'
    ? rawRows
    : rawRows.filter(r => r.Leverancier === selectedSupplier);
  
  // Segment filter toepassen
  if (selectedSegment !== '__all') {
    if (selectedSegment === 'ci') {
      baseRows = baseRows.filter(r => ciArtikelen.has(r.Artikel));
    } else if (selectedSegment === 'residentieel') {
      baseRows = baseRows.filter(r => !ciArtikelen.has(r.Artikel));
    }
  }
  
  const groepen = [...new Set(baseRows.map(r => r.Artikelgroep))]
    .filter(g => g != null && g !== '')
    .sort();
  artikelgroepSelect.innerHTML =
    `<option value="__all">Alle artikelgroepen</option>` +
    groepen.map(g => `<option value="${g}">${g}</option>`).join('');
  // probeer geselecteerde waarde te behouden indien nog beschikbaar
  artikelgroepSelect.value = groepen.includes(selectedArtikelgroep) ? selectedArtikelgroep : '__all';
}

// Land dropdown opbouwen
function buildCountryList() {                       // ▼ nieuw
  const baseRows = selectedSupplier === '__all'
    ? rawRows
    : rawRows.filter(r => r.Leverancier === selectedSupplier);
  const landen = [...new Set(baseRows.map(getCountry))]
    .filter(l => l != null && l !== '')
    .sort();
  countrySelect.innerHTML =
    `<option value="__all">Alle landen</option>` +
    landen.map(l => `<option value="${l}">${l}</option>`).join('');
  countrySelect.value = landen.includes(selectedCountry) ? selectedCountry : '__all';
}

// Klant dropdown opbouwen
function buildCustomerSelectList() {
  let baseRows = selectedSupplier === '__all'
    ? rawRows
    : rawRows.filter(r => r.Leverancier === selectedSupplier);
  
  // Segment filter toepassen
  if (selectedSegment !== '__all') {
    if (selectedSegment === 'ci') {
      baseRows = baseRows.filter(r => ciArtikelen.has(r.Artikel));
    } else if (selectedSegment === 'residentieel') {
      baseRows = baseRows.filter(r => !ciArtikelen.has(r.Artikel));
    }
  }
  
  if (selectedArtikelgroep !== '__all') {
    baseRows = baseRows.filter(r => r.Artikelgroep === selectedArtikelgroep);
  }
  
  if (selectedCountry !== '__all') {
    baseRows = baseRows.filter(r => getCountry(r) === selectedCountry);
  }
  
  const klanten = [...new Set(baseRows.map(r => r['Besteld door']))]
    .filter(k => k != null && k !== '')
    .sort();
  
  customerSelect.innerHTML =
    `<option value="__all">Alle klanten</option>` +
    klanten.map(k => `<option value="${k}">${k}</option>`).join('');
  customerSelect.value = klanten.includes(selectedCustomer) ? selectedCustomer : '__all';
}

// Robust country accessor: supports 'land', 'Land', 'LAND', etc.
function getCountry(row) {
  if (!row || typeof row !== 'object') return undefined;
  // Fast path
  if (row.land != null && row.land !== '') return String(row.land).trim();
  if (row.Land != null && row.Land !== '') return String(row.Land).trim();
  // Fallback: case-insensitive key lookup
  const key = Object.keys(row).find(k => k.trim().toLowerCase() === 'land');
  if (key) {
    const v = row[key];
    return v == null ? undefined : String(v).trim();
  }
  return undefined;
}

/* ----------  Nieuw merk UI  ---------- */
const addBtn   = document.getElementById('addSupplierBtn');
const formBox  = document.getElementById('newSupplierForm');
const fName    = document.getElementById('newSupName');
const fStart   = document.getElementById('newSupStart');
const fCust    = document.getElementById('newSupCustomers');
const fAvgRev  = document.getElementById('newSupAvgRev');

addBtn.addEventListener('click', () => {
  formBox.classList.toggle('hidden');
});

document.getElementById('cancelNewSupplierBtn')
        .addEventListener('click', () => formBox.classList.add('hidden'));

document.getElementById('saveNewSupplierBtn')
        .addEventListener('click', () => {
  const name   = fName.value.trim();
  const start  = fStart.value;
  const cust   = +fCust.value;
  const avgRev = +fAvgRev.value;

  if (!name || !start || !cust || !avgRev) return alert('Vul alle velden in.');

  newSuppliers.push({
    name,
    start,                 // 'YYYY-MM'
    newCust:  cust,
    baseRev:  avgRev,
    curRev:   avgRev,      // mutabel
    cumCust:  0,           // mutabel
  });
  formBox.classList.add('hidden');
  fName.value = fStart.value = fCust.value = fAvgRev.value = '';

  buildSupplierList();           // dropdown updaten
  renderChart();                 // direct effect tonen
});

/* ----------  Config save / load  ---------- */
function makeSnapshot() {
  const obj = {
    kpis,
    baselineMode, baselineMonth, baselineFrom, baselineTo,
    forecastMode,                       // ▼ nieuw
    useSeasonality,                    // ▼ nieuw
    customerMode, newCustomersPerMonth, onboardingCurve, avgRevenuePerCustomerAbs, avgRevenuePerCustomerManual, // ▼ nieuw
    manualCustomerPlan: [...manualCustomerPlan], // ▼ nieuw
    showExtraYears,                    // ▼ nieuw
    showTrendline,
    showMarketGrowth,                  // ▼ nieuw - marktgroei zichtbaarheid
    marketGrowthRate,                  // ▼ nieuw - marktgroei percentage
    selectedSupplier,
    selectedArtikelgroep, selectedCountry, selectedCustomer, selectedSegment, // ▼ nieuw
    dateFilterFrom, dateFilterTo,  // ▼ nieuw
    ciArtikelen: [...ciArtikelen], // ▼ nieuw - C&I markeringen (artikelen)
    newSuppliers,
    eventCustomers: [...eventCustomersMap].map(
      ([sup, set]) => [sup, [...set]]),
    eventSettings: [...eventSettings].map(([k, v]) => [k, v]), // ▼ nieuw - event-klant instellingen
    individualCustomerSettings: [...individualCustomerSettings].map(([k, v]) => [k, v]), // ▼ nieuw
    seasonalityOverrides,
    hasManualSeasonalityOverrides,     // ▼ nieuw - track handmatige overrides
    seasonalityConfig: {               // ▼ nieuw - seizoensindex configuratie
      name: 'Huidige seizoensindex configuratie',
      factors: seasonalityOverrides.map(f => f),
      timestamp: new Date().toISOString(),
      description: 'Maandfactoren voor seizoensindex'
    },
  };
  return obj;
}

function safeMakeSnapshot() {
  try {
    return makeSnapshot();
  } catch (err) {
    console.error('Maken van snapshot mislukt', err);
    alert('Opslaan van de instellingen is mislukt. Controleer de console voor details.');
    return null;
  }
}

function safeLoadSnapshot(obj) {
  try {
    loadSnapshot(obj);
  } catch (err) {
    console.error('Laden van snapshot mislukt', err, obj);
    throw err;
  }
}

function loadSnapshot(obj) {
  if (!obj || typeof obj !== 'object') {
    throw new Error('Snapshot is geen object');
  }

  if (obj.kpis && typeof obj.kpis === 'object') {
    Object.assign(kpis, obj.kpis);
  }
  ({
     baselineMode = baselineMode,
     baselineMonth = baselineMonth,
     baselineFrom = baselineFrom,
     baselineTo = baselineTo,
     forecastMode = forecastMode,
     useSeasonality = useSeasonality,
     customerMode = customerMode,
     newCustomersPerMonth = newCustomersPerMonth,
     onboardingCurve = onboardingCurve,
     avgRevenuePerCustomerAbs = avgRevenuePerCustomerAbs,
     avgRevenuePerCustomerManual = (obj.avgRevenuePerCustomerManual != null) ? Number(obj.avgRevenuePerCustomerManual) || 0 : 0,
     selectedSupplier = selectedSupplier,
     selectedArtikelgroep = selectedArtikelgroep,
     selectedCountry = selectedCountry,
     selectedCustomer = selectedCustomer,
     selectedSegment = selectedSegment,
     dateFilterFrom = dateFilterFrom,
     dateFilterTo = dateFilterTo
   } = obj);

  manualCustomerPlan = new Map();
  if (Array.isArray(obj.manualCustomerPlan)) {
    obj.manualCustomerPlan.forEach(entry => {
      if (Array.isArray(entry) && entry.length === 2) {
        const [key, value] = entry;
        const num = Number(value);
        if (typeof key === 'string' && key && Number.isFinite(num) && num >= 0) {
          manualCustomerPlan.set(key, num);
        }
      }
    });
  }
  manualPlanMonths = [];
  manualPlanBaseline = 0;

  // Extra jaren instellingen
  showExtraYears = !!obj.showExtraYears;
  // zet checkbox indien aanwezig
  const extraYearsChk = document.getElementById('showExtraYears');
  if (extraYearsChk) extraYearsChk.checked = showExtraYears;
  showTrendline = obj.showTrendline !== undefined ? !!obj.showTrendline : true;
  if (trendlineToggle) trendlineToggle.checked = showTrendline;
  showMarketGrowth = obj.showMarketGrowth !== undefined ? !!obj.showMarketGrowth : false;
  if (marketGrowthToggle) marketGrowthToggle.checked = showMarketGrowth;
  marketGrowthRate = obj.marketGrowthRate !== undefined ? parseFloat(obj.marketGrowthRate) || 2 : 2;
  if (marketGrowthRateInput) marketGrowthRateInput.value = marketGrowthRate;
  forecastMonths = computeForecastMonths();

  if (Array.isArray(obj.seasonalityOverrides) && obj.seasonalityOverrides.length === 12) {
    seasonalityOverrides = obj.seasonalityOverrides.map(v => (v == null ? null : Number(v)));
  } else {
    seasonalityOverrides = Array(12).fill(null);
  }
  
  // Laad seizoensindex configuratie als beschikbaar
  if (obj.seasonalityConfig && obj.seasonalityConfig.factors && Array.isArray(obj.seasonalityConfig.factors) && obj.seasonalityConfig.factors.length === 12) {
    seasonalityOverrides = obj.seasonalityConfig.factors.map(v => (v == null ? null : Number(v)));
  }
  
  // Herstel handmatige overrides flag
  hasManualSeasonalityOverrides = obj.hasManualSeasonalityOverrides || false;

  newSuppliers.length = 0;
  if (Array.isArray(obj.newSuppliers)) {
    newSuppliers.push(...obj.newSuppliers);
  }

  eventCustomersMap.clear();
  if (Array.isArray(obj.eventCustomers)) {
    obj.eventCustomers.forEach(([sup, arr]) => {
      if (typeof sup === 'string' && Array.isArray(arr)) {
        eventCustomersMap.set(sup, new Set(arr));
      }
    });
  }

  // Herstel event-klant instellingen
  eventSettings.clear();
  if (Array.isArray(obj.eventSettings)) {
    obj.eventSettings.forEach(([customer, settings]) => {
      if (typeof customer === 'string' && settings && typeof settings === 'object') {
        eventSettings.set(customer, {
          growth: Number(settings.growth) || 0,
          stop: settings.stop || '',
          includeInSeasonality: !!settings.includeInSeasonality,
          changeMonth: settings.changeMonth || '',
          changePct: Number(settings.changePct) || 0,
          excludeFromTarget: !!settings.excludeFromTarget
        });
      }
    });
  }

  individualCustomerSettings.clear();
  if (Array.isArray(obj.individualCustomerSettings)) {
    obj.individualCustomerSettings.forEach(([customer, settings]) => {
      if (typeof customer === 'string' && settings && typeof settings === 'object') {
        individualCustomerSettings.set(customer, settings);
      }
    });
  }

  // C&I artikelen herstellen
  ciArtikelen.clear();
  if (Array.isArray(obj.ciArtikelen)) {
    obj.ciArtikelen.forEach(a => {
      if (typeof a === 'string') ciArtikelen.add(a);
    });
  } else if (Array.isArray(obj.ciArtikelgroepen)) {
    obj.ciArtikelgroepen.forEach(a => {
      if (typeof a === 'string') ciArtikelen.add(a);
    });
  }

  // UI bijwerken
  buildKpiPanel();
  const baselineMonthEl = document.getElementById('baselineMonth');
  if (baselineMonthEl) baselineMonthEl.value = baselineMonth;
  const baselineFromEl = document.getElementById('baselineFrom');
  if (baselineFromEl) baselineFromEl.value = baselineFrom;
  const baselineToEl = document.getElementById('baselineTo');
  if (baselineToEl) baselineToEl.value = baselineTo;
  // radio-knop herstellen
  const baselineModeRadio = baselinePanel?.querySelector(`input[name="baselineMode"][value="${baselineMode}"]`);
  if (baselineModeRadio) baselineModeRadio.checked = true;
  // forecast mode herstellen
  const forecastModeRadio = baselinePanel?.querySelector(`input[name=forecastMode][value="${forecastMode}"]`);
  if (forecastModeRadio) forecastModeRadio.checked = true;
  // seasonality checkbox
  const useSeasonalityEl = document.getElementById('useSeasonality');
  if (useSeasonalityEl) useSeasonalityEl.checked = !!useSeasonality;
  // customer mode & inputs
  const customerModeRadio = baselinePanel?.querySelector(`input[name="customerMode"][value="${customerMode}"]`);
  if (customerModeRadio) customerModeRadio.checked = true;
  const newCustomersPerMonthEl = document.getElementById('newCustomersPerMonth');
  if (newCustomersPerMonthEl) newCustomersPerMonthEl.value = newCustomersPerMonth ?? 0;
  // Onboarding curve - nu slider + number input
  const onboardingCurveSlider = document.getElementById('onboardingCurveSlider');
  const onboardingCurveNumber = document.getElementById('onboardingCurveNumber');
  if (onboardingCurveSlider) onboardingCurveSlider.value = onboardingCurve ?? 1;
  if (onboardingCurveNumber) onboardingCurveNumber.value = onboardingCurve ?? 1;
  const avgRevenuePerCustomerAbsEl = document.getElementById('avgRevenuePerCustomerAbs');
  if (avgRevenuePerCustomerAbsEl) avgRevenuePerCustomerAbsEl.value = avgRevenuePerCustomerAbs ?? 0;
  const avgRevenuePerCustomerManualEl = document.getElementById('avgRevenuePerCustomerManual');
  if (avgRevenuePerCustomerManualEl) {
    avgRevenuePerCustomerManualEl.value = avgRevenuePerCustomerManual ?? 0;
  }
  const absoluteCustomerConfigEl = document.getElementById('absoluteCustomerConfig');
  if (absoluteCustomerConfigEl) {
    absoluteCustomerConfigEl.classList.toggle('hidden', customerMode !== 'absolute');
  }
  if (manualCustomerContainer) {
    manualCustomerContainer.classList.toggle('hidden', customerMode !== 'manual');
    if (customerMode === 'manual') {
      renderManualCustomerConfig(manualPlanMonths, manualPlanBaseline);
    }
  }
  
  // Datumfilter UI herstellen
  const dateFilterFromEl = document.getElementById('dateFilterFrom');
  if (dateFilterFromEl) dateFilterFromEl.value = dateFilterFrom;
  const dateFilterToEl = document.getElementById('dateFilterTo');
  if (dateFilterToEl) dateFilterToEl.value = dateFilterTo;
  
  buildCiMarkingList();                              // ▼ nieuw - herstel C&I markering UI
  renderIndividualCustomerPanel();                   // ▼ nieuw
  
  // Belangrijke volgorde: supplier eerst instellen, dan eventCustomers laden, dan lijst bouwen
  buildSupplierList();
  if (supplierSelect) supplierSelect.value = selectedSupplier;
  loadEventSet();                                    // Moet NA selectedSupplier zijn ingesteld (zet eventCustomers alias)
  buildCustomerList();                               // Bouwt checkboxes op basis van eventCustomers
  renderEventControls();                             // ▼ nieuw - herstel event-klant kaartjes na laden (moet NA buildCustomerList)
  
  buildArtikelgroepList();                           // ▼ nieuw
  if (artikelgroepSelect) artikelgroepSelect.value = selectedArtikelgroep;   // ▼ nieuw
  buildCountryList();
  if (countrySelect) countrySelect.value = selectedCountry;
  buildCustomerSelectList();                         // ▼ nieuw
  if (customerSelect) customerSelect.value = selectedCustomer;           // ▼ nieuw
  if (segmentSelect) {
    segmentSelect.value = selectedSegment || '__all';
  }
  updateDateFilterInfo();  // ▼ nieuw
  renderChart();
  renderScenarioList();
}

// Datumfilter event listeners
document.getElementById('applyDateFilter').addEventListener('click', () => {
  dateFilterFrom = document.getElementById('dateFilterFrom').value;
  dateFilterTo = document.getElementById('dateFilterTo').value;
  
  // Validatie
  if (dateFilterFrom && dateFilterTo && dateFilterFrom > dateFilterTo) {
    alert('De "vanaf datum" moet voor de "tot datum" liggen.');
    return;
  }
  
  buildKpiPanel(); // Herbereken onboarding analyse
  renderChart();
  updateDateFilterInfo();
});

document.getElementById('clearDateFilter').addEventListener('click', () => {
  dateFilterFrom = '';
  dateFilterTo = '';
  document.getElementById('dateFilterFrom').value = '';
  document.getElementById('dateFilterTo').value = '';
  buildKpiPanel(); // Herbereken onboarding analyse
  renderChart();
  updateDateFilterInfo();
});

function updateDateFilterInfo() {
  const info = document.getElementById('dateFilterInfo');
  if (dateFilterFrom || dateFilterTo) {
    const from = dateFilterFrom || 'begin';
    const to = dateFilterTo || 'eind';
    info.textContent = `Filter actief: ${from} t/m ${to}`;
    info.className = 'mt-2 text-sm text-blue-600 font-medium';
  } else {
    info.textContent = 'Laat leeg om alle datums te tonen';
    info.className = 'mt-2 text-sm text-gray-600';
  }
}

/* ----------  Configuratie Management Systeem  ---------- */

// Haal alle opgeslagen configuraties op
function getAllConfigs() {
  try {
    const stored = localStorage.getItem(CONFIGS_STORAGE_KEY);
    if (!stored) return [];
    const configs = JSON.parse(stored);
    return Array.isArray(configs) ? configs : [];
  } catch (err) {
    console.error('Fout bij laden van configuraties', err);
    return [];
  }
}

// Sla configuraties op
function saveAllConfigs(configs) {
  try {
    localStorage.setItem(CONFIGS_STORAGE_KEY, JSON.stringify(configs));
    return true;
  } catch (err) {
    console.error('Fout bij opslaan van configuraties', err);
    alert('Opslaan mislukt. Mogelijk is er onvoldoende ruimte in localStorage.');
    return false;
  }
}

// Voeg een nieuwe configuratie toe
function addConfig(name, description, snapshot) {
  const configs = getAllConfigs();
  const newConfig = {
    id: Date.now(),
    name: name.trim(),
    description: (description || '').trim(),
    timestamp: new Date().toISOString(),
    snapshot: snapshot
  };
  configs.unshift(newConfig); // Nieuwste eerst
  // Beperk tot 50 configuraties om ruimte te besparen
  if (configs.length > 50) {
    configs.splice(50);
  }
  return saveAllConfigs(configs) ? newConfig : null;
}

// Verwijder een configuratie
function deleteConfig(id) {
  const configs = getAllConfigs();
  const filtered = configs.filter(c => c.id !== id);
  return saveAllConfigs(filtered);
}

// Zoek configuraties
function searchConfigs(query) {
  const configs = getAllConfigs();
  if (!query || !query.trim()) return configs;
  const q = query.toLowerCase().trim();
  return configs.filter(c => 
    c.name.toLowerCase().includes(q) || 
    (c.description && c.description.toLowerCase().includes(q))
  );
}

// Render configuratie lijst
function renderConfigList(searchQuery = '') {
  const container = document.getElementById('configListContainer');
  if (!container) return;
  
  const configs = searchConfigs(searchQuery);
  
  if (configs.length === 0) {
    container.innerHTML = '<p class="text-sm text-gray-500 text-center py-4">Geen configuraties gevonden.</p>';
    return;
  }
  
  container.innerHTML = configs.map(config => {
    const date = new Date(config.timestamp);
    const dateStr = date.toLocaleDateString('nl-NL', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    
    return `
      <div class="border rounded-lg p-4 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
        <div class="flex items-start justify-between gap-4">
          <div class="flex-1 min-w-0">
            <h3 class="font-semibold text-lg mb-1">${escapeHtml(config.name)}</h3>
            ${config.description ? `<p class="text-sm text-gray-600 dark:text-gray-400 mb-2">${escapeHtml(config.description)}</p>` : ''}
            <p class="text-xs text-gray-500">${dateStr}</p>
          </div>
          <div class="flex gap-2 flex-shrink-0">
            <button class="config-load-btn px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700" 
                    data-config-id="${config.id}">
              Laden
            </button>
            <button class="config-delete-btn px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700" 
                    data-config-id="${config.id}">
              Verwijder
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
  
  // Event listeners voor buttons
  container.querySelectorAll('.config-load-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.configId);
      loadConfigById(id);
    });
  });
  
  container.querySelectorAll('.config-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.configId);
      if (confirm('Weet je zeker dat je deze configuratie wilt verwijderen?')) {
        if (deleteConfig(id)) {
          renderConfigList(searchQuery);
        }
      }
    });
  });
}

// Laad een configuratie op ID
function loadConfigById(id) {
  const configs = getAllConfigs();
  const config = configs.find(c => c.id === id);
  if (!config || !config.snapshot) {
    alert('Configuratie niet gevonden of ongeldig.');
    return;
  }
  
  try {
    safeLoadSnapshot(config.snapshot);
    closeLoadModal();
    alert(`Configuratie "${config.name}" geladen.`);
    renderChart();
  } catch (err) {
    console.error('Fout bij laden van configuratie', err);
    alert('Fout bij laden van configuratie. Controleer de console voor details.');
  }
}

// Modal functies
function openSaveModal() {
  const modal = document.getElementById('saveConfigModal');
  const nameInput = document.getElementById('configNameInput');
  const descInput = document.getElementById('configDescriptionInput');
  if (modal && nameInput) {
    nameInput.value = '';
    descInput.value = '';
    modal.classList.remove('hidden');
    nameInput.focus();
  }
}

function closeSaveModal() {
  const modal = document.getElementById('saveConfigModal');
  if (modal) modal.classList.add('hidden');
}

function openLoadModal() {
  const modal = document.getElementById('loadConfigModal');
  const searchInput = document.getElementById('configSearchInput');
  if (modal) {
    modal.classList.remove('hidden');
    renderConfigList('');
    if (searchInput) {
      searchInput.value = '';
      searchInput.focus();
    }
  }
}

function closeLoadModal() {
  const modal = document.getElementById('loadConfigModal');
  if (modal) modal.classList.add('hidden');
}

// Event listeners voor modals
document.getElementById('saveConfigBtn')?.addEventListener('click', () => {
  openSaveModal();
});

document.getElementById('saveConfigCancelBtn')?.addEventListener('click', () => {
  closeSaveModal();
});

document.getElementById('saveConfigConfirmBtn')?.addEventListener('click', () => {
  const nameInput = document.getElementById('configNameInput');
  const descInput = document.getElementById('configDescriptionInput');
  const name = nameInput?.value.trim();
  
  if (!name) {
    alert('Geef een naam op voor de configuratie.');
    nameInput?.focus();
    return;
  }
  
  const snapshot = safeMakeSnapshot();
  if (!snapshot) return;
  
  const config = addConfig(name, descInput?.value || '', snapshot);
  if (config) {
    closeSaveModal();
    alert(`Configuratie "${name}" opgeslagen!`);
    
    // Optioneel: ook als bestand downloaden
    try {
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download mislukt', err);
    }
  }
});

document.getElementById('loadConfigBtn')?.addEventListener('click', () => {
  openLoadModal();
});

document.getElementById('loadConfigCancelBtn')?.addEventListener('click', () => {
  closeLoadModal();
});

document.getElementById('loadConfigFromFileBtn')?.addEventListener('click', () => {
  document.getElementById('loadConfigInput')?.click();
});

// Zoekfunctie
document.getElementById('configSearchInput')?.addEventListener('input', (e) => {
  renderConfigList(e.target.value);
});

// Sluit modals bij klik buiten modal
document.getElementById('saveConfigModal')?.addEventListener('click', (e) => {
  if (e.target.id === 'saveConfigModal') closeSaveModal();
});

document.getElementById('loadConfigModal')?.addEventListener('click', (e) => {
  if (e.target.id === 'loadConfigModal') closeLoadModal();
});

// Bestand laden (oude functionaliteit behouden)
const loadInput = document.getElementById('loadConfigInput');
loadInput?.addEventListener('change', e => {
  const file = e.target.files?.[0];
  if (!file) return;
  const fr = new FileReader();
  fr.onload = evt => {
    try {
      const parsed = JSON.parse(evt.target.result);
      safeLoadSnapshot(parsed);
      closeLoadModal();
      alert('Instellingen geladen.');
      renderChart();
    } catch (err) {
      alert('Ongeldig JSON-bestand of onbekende structuur.');
    }
  };
  fr.readAsText(file);
  e.target.value = ''; // Reset input
});

if (trendlineToggle) {
  trendlineToggle.addEventListener('change', () => {
    showTrendline = trendlineToggle.checked;
    renderChart();
  });
}

const marketGrowthToggle = document.getElementById('toggleMarketGrowth');
const marketGrowthRateInput = document.getElementById('marketGrowthRate');
if (marketGrowthToggle) {
  marketGrowthToggle.addEventListener('change', () => {
    showMarketGrowth = marketGrowthToggle.checked;
    renderChart();
  });
}
if (marketGrowthRateInput) {
  marketGrowthRateInput.addEventListener('input', () => {
    marketGrowthRate = parseFloat(marketGrowthRateInput.value) || 0;
    if (showMarketGrowth) {
      renderChart();
    }
  });
}


/* -------------  CSV PARSEN  ------------- */
fileInput.addEventListener('change', e => {
  const file = e.target.files?.[0];
  if (!file) return;

  Papa.parse(file, {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,           // haalt lege regels weg
    transformHeader: h => h.trim(), // verwijdert spaties/tabs
    transform: v =>
      (typeof v === 'string' ? v.trim() : v), // idem voor waarden
    
    complete: ({ data }) => {
      rawRows = data.filter(r => r.Artikel && r.Maand);
      manualCustomerPlan.clear();
      manualPlanMonths = [];
      manualPlanBaseline = 0;
      buildSupplierList();     // ▼ nieuw
      buildArtikelgroepList(); // ▼ nieuw
      buildCountryList();      // ▼ nieuw
      buildCustomerSelectList(); // ▼ nieuw
      buildCiMarkingList();     // ▼ nieuw - bouw C&I markering lijst
      artikelgroepSelect.value = '__all';
      selectedArtikelgroep = artikelgroepSelect.value;
      countrySelect.value = '__all';
      selectedCountry = countrySelect.value;
      customerSelect.value = '__all';
      selectedCustomer = customerSelect.value;
      selectedSupplier = '__all';
      loadEventSet();          // ▼ nieuw
      buildCustomerList();
              buildKpiPanel();
        updateDateFilterInfo();  // ▼ nieuw
        
        // Bewaar ruwe data voor gebruik in Artikelcombinaties (aparte tab)
        try { localStorage.setItem('rawRows', JSON.stringify(rawRows)); } catch {}
        
        // default = laatste maand + range van 6 mnd terug
const lastDate  = rawRows
.map(r => new Date(r.Jaar, r.Maand - 1))
.sort((a, b) => b - a)[0];
baselineMonth = `${lastDate.getFullYear()}-${String(lastDate.getMonth() + 1).padStart(2, '0')}`;
document.getElementById('baselineMonth').value = baselineMonth;

const from = new Date(lastDate);
from.setMonth(from.getMonth() - 5);
baselineFrom = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}`;
baselineTo   = baselineMonth;
document.getElementById('baselineFrom').value = baselineFrom;
document.getElementById('baselineTo').value   = baselineTo;
console.table(rawRows[0]);  
      // Horizon initialiseren o.b.v. toggle
      try { showExtraYears = !!document.getElementById('showExtraYears')?.checked; } catch {}
      forecastMonths = computeForecastMonths();
      renderChart();

      // Deel data met Artikelcombinaties tab (fallback naast localStorage)
      try {
        localStorage.setItem('rawRows', JSON.stringify(rawRows));
        window.name = JSON.stringify({ rawRows });
      } catch {}
    },
  });
  
});

/* -------------  CUSTOMER-LIST UI ------------- */
function buildCustomerList() {
  // filter rows op supplier
  let rows = selectedSupplier === '__all'
    ? rawRows
    : rawRows.filter(r => r.Leverancier === selectedSupplier);

  // Segment filter toepassen
  if (selectedSegment !== '__all') {
    if (selectedSegment === 'ci') {
      rows = rows.filter(r => ciArtikelen.has(r.Artikel));
    } else if (selectedSegment === 'residentieel') {
      rows = rows.filter(r => !ciArtikelen.has(r.Artikel));
    }
  }

  // Artikelgroepfilter toepassen
  if (selectedArtikelgroep !== '__all') {
    rows = rows.filter(r => r.Artikelgroep === selectedArtikelgroep);
  }

  // Landfilter toepassen
  if (selectedCountry !== '__all') {
    rows = rows.filter(r => (r.land ?? r.Land) === selectedCountry);
  }

  // Datumfilter toepassen
  if (dateFilterFrom || dateFilterTo) {
    rows = rows.filter(r => {
      const rowDate = `${r.Jaar}-${String(r.Maand).padStart(2, '0')}`;
      if (dateFilterFrom && rowDate < dateFilterFrom) return false;
      if (dateFilterTo && rowDate > dateFilterTo) return false;
      return true;
    });
  }

  // aggregate omzet per klant
  const omzetPerKlant = groupBy(rows, 'Besteld door')
    .map(([klant, rs]) => [klant, sumBy(rs, r => r.Factuurbedrag)])
    .sort((a, b) => b[1] - a[1]);

  customerList.innerHTML = omzetPerKlant.map(([klant, omzet]) => `
    <label>
      <span>${klant}</span>
      <span class="ml-auto mr-2 text-sm text-gray-500">${euro(omzet)}</span>
      <input type="checkbox" data-klant="${klant}" class="eventChk"
             ${eventCustomers.has(klant) ? 'checked' : ''} />
    </label>
  `).join('');
}


customerList.addEventListener('change', e => {
  if (e.target.matches('.eventChk')) {
    const klant = e.target.dataset.klant;
    if (e.target.checked) eventCustomers.add(klant);
    else eventCustomers.delete(klant);
    renderChart();
  }
});

function renderEventControls() {
  const panel = document.getElementById('eventControlPanel');
  // 1) opruimen settings van klanten die niet meer geselecteerd zijn
  [...eventSettings.keys()].forEach(k => {
    if (!eventCustomers.has(k)) eventSettings.delete(k);
  });

  panel.innerHTML = '';
  eventCustomers.forEach(klant => {
    if (!eventSettings.has(klant)) eventSettings.set(klant, { growth: 0, stop: '', includeInSeasonality: false, changeMonth: '', changePct: 0, excludeFromTarget: false });
    const { growth, stop, includeInSeasonality = false, changeMonth = '', changePct = 0, excludeFromTarget = false } = eventSettings.get(klant);

    const box = document.createElement('div');
    box.className = 'p-3 border rounded-md';
    box.dataset.client = klant;
    box.innerHTML = `
      <div class="font-medium mb-2">${klant}</div>

      <label class="flex items-center gap-2 text-xs mb-2 cursor-pointer">
        <input type="checkbox" class="event-exclude-target" ${excludeFromTarget ? 'checked' : ''}>
        <span class="font-semibold text-red-600">Haal uit target (volledig uitsluiten van grafiek en berekeningen)</span>
      </label>

      <label class="flex items-center gap-2 text-xs mb-3 cursor-pointer">
        <input type="checkbox" class="event-seasonality" ${includeInSeasonality ? 'checked' : ''}>
        <span>Meetellen voor seizoensindex berekening</span>
      </label>

      <label class="block text-xs mb-1">Stijging / daling per maand</label>
      <div class="flex items-center gap-2">
        <input type="range" min="-50" max="50" step="0.5"
               value="${growth}" class="flex-1 event-growth">
        <input type="number" min="-50" max="50" step="0.5"
               value="${growth}" class="w-20 px-2 py-1 border rounded text-sm event-growth-number"
               style="line-height: 1.25rem;">
        <span class="text-sm whitespace-nowrap">%</span>
      </div>

      <label class="block text-xs mt-3 mb-1">Structurele wijziging vanaf specifieke maand</label>
      <div class="flex gap-2 items-center">
        <input type="month" value="${changeMonth}" class="flex-1 event-change-month" placeholder="YYYY-MM">
        <input type="number" value="${changePct}" class="w-20 px-2 py-1 border rounded event-change-pct" placeholder="-50">
        <span class="text-xs">%</span>
      </div>
      <span class="block text-xs text-gray-500 mt-1">Bijv. -50% vanaf september (voorraad op)</span>

      <label class="block text-xs mt-3 mb-1">Stopmaand</label>
      <input type="month" value="${stop}" class="w-full event-stop">
    `;
    panel.appendChild(box);
  });

  // één centrale listener (voorkomt 100-en listeners)
  if (!panel.dataset.listener) {
    panel.addEventListener('input', e => {
      const wrap  = e.target.closest('[data-client]');
      if (!wrap) return;
      const klant = wrap.dataset.client;
      const cfg   = eventSettings.get(klant);

      if (e.target.matches('.event-growth')) {
        const value = Number(e.target.value);
        cfg.growth = value;
        // Sync number input
        const numberInput = wrap.querySelector('.event-growth-number');
        if (numberInput) {
          numberInput.value = value;
        }
      }
      if (e.target.matches('.event-growth-number')) {
        const min = -50;
        const max = 50;
        let value = Number(e.target.value);
        // Clamp value to valid range
        if (value < min) value = min;
        if (value > max) value = max;
        if (isNaN(value)) value = cfg.growth || 0;
        
        cfg.growth = value;
        e.target.value = value;
        // Sync slider
        const slider = wrap.querySelector('.event-growth');
        if (slider) {
          slider.value = value;
        }
      }
      if (e.target.matches('.event-stop')) {
        cfg.stop = e.target.value; // 'YYYY-MM'
      }
      if (e.target.matches('.event-exclude-target')) {
        cfg.excludeFromTarget = e.target.checked;
      }
      if (e.target.matches('.event-seasonality')) {
        cfg.includeInSeasonality = e.target.checked;
      }
      if (e.target.matches('.event-change-month')) {
        cfg.changeMonth = e.target.value; // 'YYYY-MM'
      }
      if (e.target.matches('.event-change-pct')) {
        cfg.changePct = Number(e.target.value);
      }
      renderChart();
    });
    panel.dataset.listener = 1;
  }
}

/* aanroepen zodra eventCustomers wijzigt */
customerList.addEventListener('change', () => renderEventControls());


customerSearch.addEventListener('input', e => {
  const q = e.target.value.toLowerCase();
  customerList.querySelectorAll('label').forEach(label => {
    label.style.display = label.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
});

// Wijziging leverancier → rebuild artikelgroep, then render
supplierSelect.addEventListener('change', e => {
  selectedSupplier = e.target.value;
  buildArtikelgroepList();               // ▼ nieuw
  buildCiMarkingList();                   // ▼ nieuw - update C&I lijst (artikelen)
  selectedArtikelgroep = artikelgroepSelect.value; // reset if needed
  buildCountryList();
  selectedCountry = countrySelect.value;
  buildCustomerSelectList();             // ▼ nieuw
  selectedCustomer = customerSelect.value; // reset if needed
  loadEventSet();
  buildCustomerList();
  buildKpiPanel(); // Herbereken onboarding analyse
  renderChart();
});

// Listener voor artikelgroepselectie
artikelgroepSelect.addEventListener('change', e => {   // ▼ nieuw
  selectedArtikelgroep = e.target.value;
  buildCiMarkingList();                   // ▼ nieuw - update C&I lijst met gefilterde artikelen
  buildCustomerSelectList();
  buildCustomerList();
  buildKpiPanel(); // Herbereken onboarding analyse
  renderChart();
});

countrySelect.addEventListener('change', e => {        // ▼ nieuw
  selectedCountry = e.target.value;
  buildCustomerSelectList();
  buildCustomerList();
  buildKpiPanel(); // Herbereken onboarding analyse
  renderChart();
});

customerSelect.addEventListener('change', e => {       // ▼ nieuw
  selectedCustomer = e.target.value;
  renderIndividualCustomerPanel();
  buildCustomerList();
  buildKpiPanel(); // Herbereken onboarding analyse
  renderChart();
});

// Listener voor segment selectie (C&I/Residentieel)
segmentSelect.addEventListener('change', e => {
  selectedSegment = e.target.value;
  buildArtikelgroepList();
  buildCountryList();
  buildCustomerSelectList();
  buildCustomerList();
  buildKpiPanel();
  renderChart();
});

// Toggle C&I panel
document.getElementById('toggleCiPanel').addEventListener('click', () => {
  const panel = document.getElementById('ciMarkingPanel');
  panel.classList.toggle('hidden');
});

// C&I zoekfunctie
const ciSearchInput = document.getElementById('ciSearchInput');
if (ciSearchInput) {
  ciSearchInput.addEventListener('input', (e) => {
    renderCiMarkingList(e.target.value);
  });
}

// Selecteer alle zichtbare artikelen
document.getElementById('ciSelectAllVisible').addEventListener('click', () => {
  const query = ciSearchInput ? ciSearchInput.value.toLowerCase().trim() : '';
  const filtered = query 
    ? allCiArtikelen.filter(a => a.toLowerCase().includes(query))
    : allCiArtikelen;
  
  filtered.forEach(a => ciArtikelen.add(a));
  renderCiMarkingList(query);
  buildCustomerList();
  renderChart();
});

// Deselecteer alle zichtbare artikelen
document.getElementById('ciDeselectAllVisible').addEventListener('click', () => {
  const query = ciSearchInput ? ciSearchInput.value.toLowerCase().trim() : '';
  const filtered = query 
    ? allCiArtikelen.filter(a => a.toLowerCase().includes(query))
    : allCiArtikelen;
  
  filtered.forEach(a => ciArtikelen.delete(a));
  renderCiMarkingList(query);
  buildCustomerList();
  renderChart();
});

function renderIndividualCustomerPanel() {
  const panel = document.getElementById('individualCustomerPanel');
  const controls = document.getElementById('individualCustomerControls');
  const kpiPanel = document.getElementById('kpiPanel');
  const metricBox = document.getElementById('metricBox');
  
  // Als geen specifieke klant geselecteerd: verberg panel, toon KPI
  if (selectedCustomer === '__all') {
    panel.classList.add('hidden');
    kpiPanel.style.display = '';
    metricBox.style.display = '';
    return;
  }
  
  // Toon panel, verberg KPI
  panel.classList.remove('hidden');
  kpiPanel.style.display = 'none';
  metricBox.style.display = 'none';
  
  // Haal of maak settings voor deze klant
  if (!individualCustomerSettings.has(selectedCustomer)) {
    individualCustomerSettings.set(selectedCustomer, { 
      growth: 0, 
      changeMonth: '', 
      changePct: 0,
      skipMonths: []
    });
  }
  
  const { growth = 0, changeMonth = '', changePct = 0, skipMonths = [] } = individualCustomerSettings.get(selectedCustomer);
  
  // Render controls (zoals event-klant)
  const skipMonthsHtml = skipMonths.map(m => `
    <div class="flex items-center gap-2 bg-red-50 px-2 py-1 rounded">
      <span class="text-sm">${m}</span>
      <button class="text-red-600 hover:text-red-800 font-bold text-xs remove-skip-month" data-month="${m}">✕</button>
    </div>
  `).join('');
  
  controls.innerHTML = `
    <div class="p-3 border rounded-md bg-white">
      <div class="font-medium mb-2">${selectedCustomer}</div>
      
      <label class="block text-xs mb-1">Stijging / daling per maand</label>
      <div class="flex items-center gap-2">
        <input type="range" min="-50" max="50" step="0.5"
               value="${growth}" class="flex-1 individual-growth">
        <input type="number" min="-50" max="50" step="0.5"
               value="${growth}" class="w-20 px-2 py-1 border rounded text-sm individual-growth-number"
               style="line-height: 1.25rem;">
        <span class="text-sm whitespace-nowrap">%</span>
      </div>

      <label class="block text-xs mt-3 mb-1">Structurele wijziging vanaf specifieke maand</label>
      <div class="flex gap-2 items-center">
        <input type="month" value="${changeMonth}" class="flex-1 individual-change-month" placeholder="YYYY-MM">
        <input type="number" value="${changePct}" class="w-20 px-2 py-1 border rounded individual-change-pct" placeholder="-50">
        <span class="text-xs">%</span>
      </div>
      <span class="block text-xs text-gray-500 mt-1">Bijv. -50% vanaf september</span>

      <label class="block text-xs mt-3 mb-1 font-semibold">Maanden zonder bestellingen</label>
      <div class="flex gap-2 items-center mb-2">
        <input type="month" class="flex-1 individual-skip-month-input" placeholder="YYYY-MM">
        <button class="px-3 py-1 bg-red-600 text-white rounded text-xs add-skip-month">+ Overslaan</button>
      </div>
      <div class="flex flex-wrap gap-2 skip-months-list">
        ${skipMonthsHtml || '<span class="text-xs text-gray-400">Geen maanden overgeslagen</span>'}
      </div>
      <span class="block text-xs text-gray-500 mt-1">Voeg maanden toe waar deze klant niet bestelt</span>
    </div>
  `;
  
  // Event listeners
  controls.addEventListener('input', e => {
    const cfg = individualCustomerSettings.get(selectedCustomer);
    
    if (e.target.matches('.individual-growth')) {
      const value = Number(e.target.value);
      cfg.growth = value;
      // Sync number input
      const numberInput = controls.querySelector('.individual-growth-number');
      if (numberInput) {
        numberInput.value = value;
      }
    }
    if (e.target.matches('.individual-growth-number')) {
      const min = -50;
      const max = 50;
      let value = Number(e.target.value);
      // Clamp value to valid range
      if (value < min) value = min;
      if (value > max) value = max;
      if (isNaN(value)) value = cfg.growth || 0;
      
      cfg.growth = value;
      e.target.value = value;
      // Sync slider
      const slider = controls.querySelector('.individual-growth');
      if (slider) {
        slider.value = value;
      }
    }
    if (e.target.matches('.individual-change-month')) {
      cfg.changeMonth = e.target.value;
    }
    if (e.target.matches('.individual-change-pct')) {
      cfg.changePct = Number(e.target.value);
    }
    renderChart();
  });
  
  // Add skip month
  controls.addEventListener('click', e => {
    if (e.target.matches('.add-skip-month')) {
      const input = controls.querySelector('.individual-skip-month-input');
      const month = input.value;
      if (!month) return;
      
      const cfg = individualCustomerSettings.get(selectedCustomer);
      if (!cfg.skipMonths.includes(month)) {
        cfg.skipMonths.push(month);
        cfg.skipMonths.sort(); // Sorteer chronologisch
        renderIndividualCustomerPanel(); // Re-render om lijst te updaten
        renderChart();
      }
    }
    
    // Remove skip month
    if (e.target.matches('.remove-skip-month')) {
      const month = e.target.dataset.month;
      const cfg = individualCustomerSettings.get(selectedCustomer);
      cfg.skipMonths = cfg.skipMonths.filter(m => m !== month);
      renderIndividualCustomerPanel(); // Re-render om lijst te updaten
      renderChart();
    }
  });
}

// Functie om historische onboarding snelheid te berekenen
function calculateHistoricalOnboardingSpeed() {
  if (!rawRows.length) return null;
  
  // Filter data op basis van huidige selecties
  let filteredRows = selectedSupplier === '__all' ? rawRows : rawRows.filter(r => r.Leverancier === selectedSupplier);
  
  // Segment filter toepassen
  if (selectedSegment !== '__all') {
    if (selectedSegment === 'ci') {
      filteredRows = filteredRows.filter(r => ciArtikelen.has(r.Artikel));
    } else if (selectedSegment === 'residentieel') {
      filteredRows = filteredRows.filter(r => !ciArtikelen.has(r.Artikel));
    }
  }
  
  if (selectedArtikelgroep !== '__all') {
    filteredRows = filteredRows.filter(r => r.Artikelgroep === selectedArtikelgroep);
  }
  if (selectedCountry !== '__all') {
    filteredRows = filteredRows.filter(r => (r.land ?? r.Land) === selectedCountry);
  }
  if (selectedCustomer !== '__all') {
    filteredRows = filteredRows.filter(r => r['Besteld door'] === selectedCustomer);
  }
  
  // Datumfilter toepassen (zoals in renderChart)
  if (dateFilterFrom || dateFilterTo) {
    filteredRows = filteredRows.filter(r => {
      const rowDate = `${r.Jaar}-${String(r.Maand).padStart(2, '0')}`;
      if (dateFilterFrom && rowDate < dateFilterFrom) return false;
      if (dateFilterTo && rowDate > dateFilterTo) return false;
      return true;
    });
  }
  
  // Groepeer per klant en maand
  const customerMonths = new Map(); // klant -> [maanden met omzet]
  filteredRows.forEach(row => {
    const klant = row['Besteld door'];
    const maand = `${row.Jaar}-${String(row.Maand).padStart(2, '0')}`;
    const omzet = Number(row.Factuurbedrag) || 0;
    
    if (!customerMonths.has(klant)) {
      customerMonths.set(klant, new Map());
    }
    customerMonths.get(klant).set(maand, omzet);
  });
  
  // Analyseer onboarding patronen
  const onboardingAnalysis = [];
  
  customerMonths.forEach((months, klant) => {
    const sortedMonths = Array.from(months.keys()).sort();
    if (sortedMonths.length < 4) return; // Te weinig data
    
    // Vind eerste maand met omzet > 0
    const firstMonth = sortedMonths[0];
    const firstOmzet = months.get(firstMonth) || 0;
    if (firstOmzet <= 0) return;
    
    // Bereken gemiddelde omzet over eerste 4 maanden
    let totalOmzet = 0;
    let validMonths = 0;
    for (let i = 0; i < Math.min(4, sortedMonths.length); i++) {
      const omzet = months.get(sortedMonths[i]) || 0;
      if (omzet > 0) {
        totalOmzet += omzet;
        validMonths++;
      }
    }
    
    if (validMonths >= 2) {
      const avgOmzet = totalOmzet / validMonths;
      const firstMonthRatio = firstOmzet / avgOmzet;
      onboardingAnalysis.push({
        klant,
        firstMonthRatio,
        firstOmzet,
        avgOmzet,
        validMonths
      });
    }
  });
  
  if (onboardingAnalysis.length === 0) return null;
  
  // Bereken gemiddelde eerste-maand ratio
  const avgFirstMonthRatio = onboardingAnalysis.reduce((sum, a) => sum + a.firstMonthRatio, 0) / onboardingAnalysis.length;
  
  // Converteer ratio naar onboarding curve (0.1 = 10% eerste maand)
  // Als eerste maand 40% van gemiddelde is, dan is onboarding curve ongeveer 1.0x
  let estimatedCurve = 1.0;
  if (avgFirstMonthRatio > 0) {
    // Interpoleer tussen bekende punten: 10%=2.0x, 40%=1.0x, 80%=0.5x
    if (avgFirstMonthRatio <= 0.4) {
      estimatedCurve = 1.0 + (0.4 - avgFirstMonthRatio) / 0.3; // 0.1->2.0, 0.4->1.0
    } else {
      estimatedCurve = 1.0 - (avgFirstMonthRatio - 0.4) / 0.4; // 0.4->1.0, 0.8->0.5
    }
    estimatedCurve = Math.max(0.5, Math.min(2.0, estimatedCurve));
  }
  
  return {
    estimatedCurve: Math.round(estimatedCurve * 10) / 10,
    avgFirstMonthRatio: Math.round(avgFirstMonthRatio * 100) / 100,
    sampleSize: onboardingAnalysis.length,
    confidence: onboardingAnalysis.length >= 10 ? 'hoog' : onboardingAnalysis.length >= 5 ? 'gemiddeld' : 'laag'
  };
}

function buildKpiPanel() {
  const panel = document.getElementById('kpiPanel');
  panel.innerHTML = ''; // reset (bij nieuwe upload)

  const defs = [
    ['churn',      'Churn %'],
    ['newBiz',     'New business %'],
    ['growth',     'Omzetgroei %'],
    ['dipDec',     'Dip december %'],
    ['dipBouwvak', 'Dip bouwvak %'],
  ];

  const activeDefs = (customerMode === 'absolute')
    ? defs.filter(([key]) => key !== 'newBiz')
    : defs;

  activeDefs.forEach(([key, label]) => {
    const wrapper = document.createElement('div');
    const badgeNeeded = ['churn', 'newBiz', 'growth'].includes(key);
    const badge = badgeNeeded
      ? `<span id="hist-${key}"
               class="ml-2 text-xs text-gray-500 align-middle cursor-help"
               title=""></span>`           
      : '';
    

    wrapper.innerHTML = `
      <label class="block text-sm font-medium mb-1">${label}${badge}</label>
      <div class="flex items-center gap-2">
        <input type="range" min="0" max="50" step="0.5"
               value="${kpis[key]}"
               data-kpi="${key}"
               class="flex-1 accent-blue-600">
        <input type="number" min="0" max="50" step="0.5"
               value="${kpis[key]}"
               data-kpi-number="${key}"
               class="w-20 px-2 py-1 border rounded text-sm"
               style="line-height: 1.25rem;">
        <span class="text-sm whitespace-nowrap">%</span>
      </div>
    `;
    panel.appendChild(wrapper);
  });

  // Bereken historische onboarding snelheid
  const historicalOnboarding = calculateHistoricalOnboardingSpeed();
  
  // Voeg onboarding snelheid toe
  const onboardingWrapper = document.createElement('div');
  let historicalInfo = '';
  
  if (historicalOnboarding) {
    const confidenceColor = historicalOnboarding.confidence === 'hoog' ? 'text-green-600' : 
                           historicalOnboarding.confidence === 'gemiddeld' ? 'text-yellow-600' : 'text-orange-600';
    
    // Bouw filter info
    const activeFilters = [];
    if (selectedSupplier !== '__all') activeFilters.push(`Merk: ${selectedSupplier}`);
    if (selectedArtikelgroep !== '__all') activeFilters.push(`Groep: ${selectedArtikelgroep}`);
    if (selectedCountry !== '__all') activeFilters.push(`Land: ${selectedCountry}`);
    if (selectedCustomer !== '__all') activeFilters.push(`Klant: ${selectedCustomer}`);
    if (dateFilterFrom || dateFilterTo) {
      const from = dateFilterFrom || 'begin';
      const to = dateFilterTo || 'nu';
      activeFilters.push(`Periode: ${from} - ${to}`);
    }
    
    const filterInfo = activeFilters.length > 0 
      ? `<br>🔍 Filters: ${activeFilters.join(', ')}`
      : '';
    
    historicalInfo = `
      <div class="mt-2 p-2 bg-blue-50 rounded text-xs">
        <div class="font-medium text-blue-800 mb-1">📊 Historische analyse:</div>
        <div class="text-gray-700">
          Gemiddelde eerste maand: ${Math.round(historicalOnboarding.avgFirstMonthRatio * 100)}% van gemiddelde
          <br>Geschatte curve: <span class="font-bold ${confidenceColor}">${historicalOnboarding.estimatedCurve}x</span>
          <br>Betrouwbaarheid: <span class="${confidenceColor}">${historicalOnboarding.confidence}</span> (${historicalOnboarding.sampleSize} klanten)${filterInfo}
        </div>
        <button class="mt-1 px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700"
                onclick="applySuggestedOnboarding(${historicalOnboarding.estimatedCurve})">
          💡 Pas toe
        </button>
      </div>
    `;
  } else {
    historicalInfo = `
      <div class="mt-2 p-2 bg-gray-50 rounded text-xs text-gray-600">
        📊 Geen voldoende data voor onboarding analyse
      </div>
    `;
  }
  
  onboardingWrapper.innerHTML = `
    <label class="block text-sm font-medium mb-1">
      Onboarding snelheid
      <span class="ml-1 text-xs text-gray-500 cursor-help" title="Hoe snel nieuwe klanten tot hun volledige omzetpotentieel komen (10% → 40% → 80% → 100%)">ⓘ</span>
    </label>
    <div class="flex items-center gap-2">
      <input type="range" min="0.5" max="2" step="0.1"
             value="${onboardingCurve}"
             id="onboardingCurveSlider"
             class="flex-1 accent-blue-600">
      <input type="number" min="0.5" max="2" step="0.1"
             value="${onboardingCurve}"
             id="onboardingCurveNumber"
             class="w-20 px-2 py-1 border rounded text-sm"
             style="line-height: 1.25rem;">
      <span class="text-sm whitespace-nowrap">x</span>
    </div>
    ${historicalInfo}
  `;
  panel.appendChild(onboardingWrapper);

  // listener op panel (event-delegation)
  panel.addEventListener('input', e => {
    // KPI sliders en number inputs
    if (e.target.matches('input[type=range][data-kpi]')) {
      const key = e.target.dataset.kpi;
      if (key) {
        const value = Number(e.target.value);
        kpis[key] = value;
        // Sync number input
        const numberInput = panel.querySelector(`input[data-kpi-number="${key}"]`);
        if (numberInput) {
          numberInput.value = value;
        }
        renderChart();            // forecast ververst
      }
    }
    // KPI number inputs
    if (e.target.matches('input[type=number][data-kpi-number]')) {
      const key = e.target.dataset.kpiNumber;
      if (key) {
        const min = 0;
        const max = 50;
        let value = Number(e.target.value);
        // Clamp value to valid range
        if (value < min) value = min;
        if (value > max) value = max;
        if (isNaN(value)) value = kpis[key] || 0;
        
        kpis[key] = value;
        e.target.value = value;
        // Sync slider
        const slider = panel.querySelector(`input[type=range][data-kpi="${key}"]`);
        if (slider) {
          slider.value = value;
        }
        renderChart();
      }
    }
    // Onboarding curve slider
    if (e.target.id === 'onboardingCurveSlider') {
      const value = Number(e.target.value);
      onboardingCurve = value;
      const numberInput = document.getElementById('onboardingCurveNumber');
      if (numberInput) {
        numberInput.value = value;
      }
      renderChart();
    }
    // Onboarding curve number input
    if (e.target.id === 'onboardingCurveNumber') {
      const min = 0.5;
      const max = 2;
      let value = Number(e.target.value);
      // Clamp value to valid range
      if (value < min) value = min;
      if (value > max) value = max;
      if (isNaN(value)) value = onboardingCurve || 1;
      
      onboardingCurve = value;
      e.target.value = value;
      const slider = document.getElementById('onboardingCurveSlider');
      if (slider) {
        slider.value = value;
      }
      renderChart();
    }
  });

  // sliders (churn/newBiz) uitschakelen in absolute mode voor duidelijkheid
  const disableChurn = customerMode !== 'percent';
  const disableNewBiz = customerMode !== 'percent';
  panel.querySelectorAll('input[type=range][data-kpi="churn"], input[type=number][data-kpi-number="churn"]').forEach(inp => {
    inp.disabled = disableChurn;
    inp.classList.toggle('opacity-50', disableChurn);
  });
  panel.querySelectorAll('input[type=range][data-kpi="newBiz"], input[type=number][data-kpi-number="newBiz"]').forEach(inp => {
    inp.disabled = disableNewBiz;
    inp.classList.toggle('opacity-50', disableNewBiz);
  });

  // Als seizoensindex actief is: 'Dip december' en 'Dip bouwvak' uitschakelen
  const seasonalityActive = useSeasonality && forecastMode === 'kpi';
  panel.querySelectorAll('input[type=range][data-kpi="dipDec"], input[type=number][data-kpi-number="dipDec"], input[type=range][data-kpi="dipBouwvak"], input[type=number][data-kpi-number="dipBouwvak"]').forEach(inp => {
    inp.disabled = seasonalityActive;
    inp.classList.toggle('opacity-50', seasonalityActive);
  });
}

// Globale functie om voorgestelde onboarding snelheid toe te passen
window.applySuggestedOnboarding = function(suggestedValue) {
  onboardingCurve = suggestedValue;
  const slider = document.getElementById('onboardingCurveSlider');
  const numberInput = document.getElementById('onboardingCurveNumber');
  
  if (slider) {
    slider.value = suggestedValue;
  }
  if (numberInput) {
    numberInput.value = suggestedValue;
  }
  renderChart();
};

function formatMonthLabel(key) {
  if (!key || typeof key !== 'string' || !key.includes('-')) return key;
  const [yearStr, monthStr] = key.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return key;
  const name = monthNamesNl[month - 1] || key;
  return `${name} ${year}`;
}

function pad2(num) {
  return String(num).padStart(2, '0');
}

function parseDateString(raw) {
  if (!raw && raw !== 0) return null;
  if (raw instanceof Date && !isNaN(raw)) return raw;
  const str = String(raw).trim();
  if (!str) return null;
  const iso = new Date(str);
  if (!isNaN(iso)) return iso;
  const match = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (match) {
    let [ , dd, mm, yyyy ] = match;
    if (yyyy.length === 2) yyyy = Number(yyyy) + 2000;
    return new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  }
  return null;
}

function parseAfleverdatum(row) {
  const raw = row.Afleverdatum ?? row['Afleverdatum'] ?? row.afleverdatum;
  let date = parseDateString(raw);
  if (date && !isNaN(date)) return date;
  const year = Number(row.Jaar ?? row.jaar);
  const month = Number(row.Maand ?? row.maand);
  const day = Number(row.Dag ?? row.dag ?? row.Dagen ?? row.dagen ?? 1);
  if (Number.isFinite(year) && Number.isFinite(month)) {
    return new Date(year, month - 1, Number.isFinite(day) ? day : 1);
  }
  return null;
}

function renderManualCustomerConfig(monthKeys = [], baselineCount = 0) {
  if (!manualCustomerContainer || !manualCustomerInputs) return;
  manualCustomerContainer.classList.toggle('hidden', customerMode !== 'manual');
  if (customerMode !== 'manual') {
    return;
  }

  if (!Array.isArray(monthKeys) || monthKeys.length === 0) {
    manualCustomerInputs.innerHTML =
      '<p class="text-sm text-gray-500">Upload data of genereer een forecast om handmatige verwachtingen in te vullen.</p>';
    return;
  }

  const validKeys = new Set(monthKeys);
  for (const key of Array.from(manualCustomerPlan.keys())) {
    if (!validKeys.has(key)) {
      manualCustomerPlan.delete(key);
    }
  }

  manualCustomerInputs.innerHTML = '';
  let lastKnown = Number(baselineCount) || 0;

  monthKeys.forEach(key => {
    const wrapper = document.createElement('label');
    wrapper.className = 'block text-sm';

    const title = document.createElement('span');
    title.className = 'block font-medium text-xs text-gray-700 mb-1';
    title.textContent = formatMonthLabel(key);

    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.step = '1';
    input.dataset.monthKey = key;
    input.dataset.inputType = 'customers';
    input.className = 'w-full px-2 py-1 border rounded text-sm';

    const stored = manualCustomerPlan.get(key);
    const numStored = Number(stored);
    if (manualCustomerPlan.has(key) && Number.isFinite(numStored)) {
      input.value = String(numStored);
      lastKnown = numStored;
    } else if (manualCustomerPlan.has(key) && !Number.isFinite(numStored)) {
      manualCustomerPlan.delete(key);
      if (lastKnown > 0) input.placeholder = String(Math.round(lastKnown));
    } else if (lastKnown > 0) {
      input.placeholder = String(Math.round(lastKnown));
    } else if (baselineCount > 0) {
      input.placeholder = String(Math.round(baselineCount));
    }

    // Event listeners met debouncing
    input.addEventListener('input', handleManualInput, { passive: true });
    input.addEventListener('blur', () => {
      clearTimeout(manualInputDebounceTimer);
      handleManualInput({ target: input });
      renderChart();
    });

    wrapper.appendChild(title);
    wrapper.appendChild(input);
    manualCustomerInputs.appendChild(wrapper);
  });
}

function handleManualInput(e) {
  const key = e.target?.dataset?.monthKey;
  const inputType = e.target?.dataset?.inputType;
  if (!key || !inputType) return;
  
  const raw = e.target.value.trim();
  
  // Debounce: wacht 300ms voordat we de chart updaten
  clearTimeout(manualInputDebounceTimer);
  
  if (inputType === 'customers') {
    if (!raw) {
      manualCustomerPlan.delete(key);
    } else {
      const val = Number(raw);
      if (Number.isFinite(val) && val >= 0) {
        manualCustomerPlan.set(key, val);
      }
    }
  }
  
  // Update chart alleen bij blur, niet tijdens typen
  // Dit voorkomt dat het veld wordt gereset tijdens typen
}

function exportDashboardToCsv() {
  if (!lastExportPayload || !Array.isArray(lastExportPayload.months) || lastExportPayload.months.length === 0) {
    alert('Geen data om te exporteren. Voer eerst een forecast uit.');
    return;
  }

  const {
    generatedAt,
    filters = {},
    dateRange = {},
    eventCustomers = [],
    months = [],
  } = lastExportPayload;

  const escapeCsvValue = (value) => {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (/[;"\r\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const formatNumber = (value, decimals = 2) => {
    if (!Number.isFinite(value)) return '';
    return value.toFixed(decimals);
  };

  const formatInteger = (value) => {
    if (!Number.isFinite(value)) return '';
    return Math.round(value).toString();
  };

  const rows = [];
  const pushRow = (...cols) => {
    rows.push(cols.map(escapeCsvValue).join(';'));
  };

  pushRow('Exportdatum', generatedAt || new Date().toISOString());
  pushRow('Gekozen leverancier', filters.supplier || 'Alle');
  pushRow('Gekozen artikelgroep', filters.artikelgroep || 'Alle');
  pushRow('Gekozen land', filters.country || 'Alle');
  pushRow('Gekozen klant', filters.customer || 'Alle');
  pushRow('Segment', filters.segment || 'Alle segmenten');
  pushRow('Forecast methode', filters.forecastMode || '');
  pushRow('Klantgroei methode', filters.customerMode || '');
  pushRow('Vanaf maand (filter)', dateRange.from || '–');
  pushRow('Tot maand (filter)', dateRange.to || '–');

  rows.push('');
  pushRow('Aangevinkte event-klanten');
  pushRow('Naam', 'Totale omzet', 'Groei %', 'Wijziging vanaf', 'Wijziging %', 'Stopmaand', 'In seizoensindex', 'Uitgesloten van target');
  if (eventCustomers.length === 0) {
    pushRow('Geen event-klanten geselecteerd');
  } else {
    eventCustomers.forEach(ev => {
      pushRow(
        ev.name,
        formatNumber(ev.totalRevenue, 2),
        formatNumber(ev.growth ?? 0, 2),
        ev.changeMonth || '',
        formatNumber(ev.changePct ?? 0, 2),
        ev.stop || '',
        ev.includeInSeasonality ? 'Ja' : 'Nee',
        ev.excludeFromTarget ? 'Ja' : 'Nee'
      );
    });
  }

  rows.push('');
  pushRow('Maand', 'Type', 'Omzet normaal', 'Omzet event', 'Totale omzet', 'Normale klanten', 'Gem. omzet per normale klant');
  months.forEach(m => {
    pushRow(
      m.month,
      m.type,
      formatNumber(m.normalRevenue ?? 0, 2),
      formatNumber(m.eventRevenue ?? 0, 2),
      formatNumber(m.totalRevenue ?? ((m.normalRevenue || 0) + (m.eventRevenue || 0)), 2),
      formatInteger(m.normalCustomers ?? 0),
      formatNumber(m.avgRevenuePerNormal ?? 0, 2),
    );
  });

  const csvContent = rows.join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const supplierPart = filters.supplier && filters.supplier !== 'Alle' ? filters.supplier.replace(/\W+/g, '-').toLowerCase() : 'alle-leveranciers';
  const fileName = `merktarget-export-${supplierPart}-${Date.now()}.csv`;

  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}

function getScenarioColor(index) {
  return scenarioColors[index % scenarioColors.length];
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch] || ch));
}

function saveScenario() {
  if (!lastScenarioCapture || !Array.isArray(lastScenarioCapture.labels) || lastScenarioCapture.labels.length === 0) {
    alert('Geen forecast om op te slaan. Voer eerst een forecast uit.');
    return;
  }
  const nameInput = scenarioNameInput?.value.trim();
  const name = nameInput || `Scenario ${scenarios.length + 1}`;

  const snapshot = makeSnapshot();
  const valueByLabel = { };
  if (lastScenarioCapture.valueByLabel) {
    Object.entries(lastScenarioCapture.valueByLabel).forEach(([label, value]) => {
      if (value != null && Number.isFinite(value)) {
        valueByLabel[label] = Number(value);
      }
    });
  }
  const snapshotLabels = Array.isArray(lastScenarioCapture.labels)
    ? lastScenarioCapture.labels.slice()
    : Object.keys(valueByLabel);

  const scenario = {
    id: Date.now(),
    name,
    color: getScenarioColor(scenarios.length),
    visible: true,
    valueByLabel,
    labels: snapshotLabels,
    snapshot,
  };
  scenarios.push(scenario);
  renderScenarioList();
  renderChart();
  if (scenarioNameInput) scenarioNameInput.value = '';
}

function renderScenarioList() {
  if (!scenarioList) return;
  if (!scenarios.length) {
    scenarioList.innerHTML = '<p class="text-xs text-gray-500">Nog geen scenario’s opgeslagen.</p>';
    return;
  }
  scenarioList.innerHTML = scenarios.map(scenario => `
    <div class="flex flex-wrap items-center gap-2" data-scenario-id="${scenario.id}">
      <span class="inline-block w-3 h-3 rounded-full" style="background:${scenario.color};"></span>
      <label class="flex items-center gap-1">
        <input type="checkbox" class="scenario-visible" ${scenario.visible ? 'checked' : ''}>
        <span>${escapeHtml(scenario.name)}</span>
      </label>
      <button type="button"
              class="scenario-load text-xs px-2 py-1 bg-slate-100 rounded hover:bg-slate-200">
        Laad
      </button>
      <button type="button"
              class="scenario-delete text-xs px-2 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200">
        Verwijder
      </button>
    </div>
  `).join('');
}

function updateLocalConfigButtons() {
  if (!loadLocalConfigBtn) return;
  try {
    const hasConfig = !!localStorage.getItem(LOCAL_CONFIG_KEY);
    loadLocalConfigBtn.disabled = !hasConfig;
    loadLocalConfigBtn.classList.toggle('opacity-50', !hasConfig);
    loadLocalConfigBtn.title = hasConfig ? '' : 'Nog geen lokale instellingen opgeslagen';
  } catch (err) {
    console.warn('Local storage niet beschikbaar', err);
    loadLocalConfigBtn.disabled = true;
    loadLocalConfigBtn.classList.add('opacity-50');
    loadLocalConfigBtn.title = 'Local storage niet beschikbaar in deze browsermodus';
  }
}

function computeOrdersPerDayData(rows, forecastLabels, forecastNormal, forecastEvent) {
  const perDayOrders = new Map();   // YYYY-MM-DD -> Set(orderNumbers)
  const orderRevenue = new Map();   // orderNumber -> revenue

  rows.forEach(row => {
    const orderNum = row.Ordernummer ?? row['Ordernummer'];
    if (!orderNum && orderNum !== 0) return;
    const dateObj = parseAfleverdatum(row);
    if (!dateObj || isNaN(dateObj)) return;
    const dateKey = `${dateObj.getFullYear()}-${pad2(dateObj.getMonth() + 1)}-${pad2(dateObj.getDate())}`;
    if (!perDayOrders.has(dateKey)) perDayOrders.set(dateKey, new Set());
    perDayOrders.get(dateKey).add(orderNum);

    const revenue = Number(row.Factuurbedrag ?? row.factuurbedrag) || 0;
    orderRevenue.set(orderNum, (orderRevenue.get(orderNum) || 0) + revenue);
  });

  const historicalMap = new Map();
  perDayOrders.forEach((set, dateKey) => {
    historicalMap.set(dateKey, set.size);
  });

  const totalHistoricalOrders = orderRevenue.size;
  let totalHistoricalRevenue = 0;
  orderRevenue.forEach(value => { totalHistoricalRevenue += value; });
  const avgOrderValue = totalHistoricalOrders > 0 ? totalHistoricalRevenue / totalHistoricalOrders : 0;

  const forecastMap = new Map();
  if (avgOrderValue > 0) {
    forecastLabels.forEach((label, idx) => {
      const revenue = (forecastNormal[idx] ?? 0) + (forecastEvent[idx] ?? 0);
      if (!Number.isFinite(revenue) || revenue <= 0) return;
      const [yearStr, monthStr] = label.split('-');
      const year = Number(yearStr);
      const month = Number(monthStr);
      if (!Number.isFinite(year) || !Number.isFinite(month)) return;
      const daysInMonth = new Date(year, month, 0).getDate();
      const ordersInMonth = revenue / avgOrderValue;
      const dailyOrders = ordersInMonth / daysInMonth;
      for (let day = 1; day <= daysInMonth; day++) {
        const dateKey = `${year}-${pad2(month)}-${pad2(day)}`;
        forecastMap.set(dateKey, dailyOrders);
      }
    });
  }

  const labels = [...new Set([
    ...historicalMap.keys(),
    ...forecastMap.keys(),
  ])].sort((a, b) => new Date(a) - new Date(b));

  const historicalSeries = labels.map(date => historicalMap.has(date) ? historicalMap.get(date) : null);
  const forecastSeries = labels.map(date => forecastMap.has(date) ? forecastMap.get(date) : null);

  const forecastValues = forecastSeries.filter(v => v != null && Number.isFinite(v));
  const averageForecastPerDay = forecastValues.length
    ? forecastValues.reduce((sum, val) => sum + val, 0) / forecastValues.length
    : 0;

  return {
    labels,
    historicalSeries,
    forecastSeries,
    totalHistoricalOrders,
    avgOrderValue,
    averageForecastPerDay,
  };
}

function updateOrdersPerDayChart(data) {
  const summaryEl = document.getElementById('ordersPerDaySummary');
  const ctx = document.getElementById('ordersPerDayChart');
  if (!ctx) return;

  if (!data || !data.labels.length) {
    if (summaryEl) summaryEl.textContent = 'Geen data beschikbaar.';
    if (ordersChart) {
      ordersChart.destroy();
      ordersChart = null;
    }
    return;
  }

  if (summaryEl) {
    const parts = [];
    parts.push(`Historische orders: ${data.totalHistoricalOrders}`);
    if (data.avgOrderValue > 0) {
      parts.push(`Gem. orderwaarde: €${data.avgOrderValue.toFixed(2)}`);
    }
    if (data.averageForecastPerDay > 0) {
      parts.push(`Forecast: ${data.averageForecastPerDay.toFixed(1)} orders/dag`);
    } else {
      parts.push('Forecast: geen waarde beschikbaar');
    }
    summaryEl.textContent = parts.join(' • ');
  }

  const chartData = {
    labels: data.labels,
    datasets: [
      {
        label: 'Orders per dag (historisch)',
        data: data.historicalSeries,
        borderColor: '#2563eb',
        backgroundColor: 'transparent',
        borderWidth: 2,
        pointRadius: data.labels.length > 90 ? 0 : 2,
        pointHoverRadius: 4,
        spanGaps: true,
        tension: 0.25,
      },
      {
        label: 'Orders per dag (forecast)',
        data: data.forecastSeries,
        borderColor: '#f97316',
        backgroundColor: 'transparent',
        borderWidth: 2,
        borderDash: [6, 4],
        pointRadius: 0,
        pointHoverRadius: 3,
        spanGaps: true,
        tension: 0.2,
      },
    ],
  };

  if (ordersChart) {
    ordersChart.data = chartData;
    ordersChart.update();
  } else {
    ordersChart = new Chart(ctx, {
      type: 'line',
      data: chartData,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom' },
          tooltip: {
            mode: 'index',
            intersect: false,
            callbacks: {
              label: (context) => {
                const label = context.dataset.label || '';
                const value = context.parsed.y;
                if (value == null) return label;
                return `${label}: ${value.toFixed(2)}`;
              },
            },
          },
        },
        interaction: { intersect: false, mode: 'index' },
        scales: {
          x: {
            ticks: {
              maxRotation: 45,
              minRotation: 45,
              autoSkip: true,
              maxTicksLimit: data.labels.length > 90 ? 12 : 24,
            },
          },
          y: {
            beginAtZero: true,
          },
        },
      },
    });
  }
}

function getMonthRange(fromKey, toKey) {
  if (!fromKey || !toKey) return [];
  const [fy, fm] = fromKey.split('-').map(Number);
  const [ty, tm] = toKey.split('-').map(Number);
  const d   = new Date(fy, fm - 1);
  const end = new Date(ty, tm - 1);
  const out = [];
  while (d <= end) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    d.setMonth(d.getMonth() + 1);
  }
  return out;
}


function calcForecast(historyMonthly, eventPerClient) {
  /* 1. Baseline-periode bepalen ------------------------------------------ */
  if (forecastMode === 'trend') {
    // Trend-based forecast: gebruik lineaire regressie over historische totalen
    const histKeys = [...historyMonthly.keys()].sort();
    const histTotals = histKeys.map(k => (historyMonthly.get(k).normal + historyMonthly.get(k).event));
    if (histTotals.length < 2) {
      return { labels: [], normal: [], event: [], customers: [], details: [] };
    }
    const x = histKeys.map((_, i) => i);
    const { slope, intercept } = computeLinearRegression(x, histTotals);
    const baseDateKey = histKeys[histKeys.length - 1];
    const [bY, bM] = baseDateKey.split('-').map(Number);
    const baseDate = new Date(bY, bM - 1);
    const keyOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

    const labels = [], normal = [], event = [], customers = [];
    for (let i = 1; i <= forecastMonths; i++) {
      const d = new Date(baseDate); d.setMonth(d.getMonth() + i);
      labels.push(keyOf(d));
      const ix = x.length - 1 + i; // doortrekken vanaf laatste index
      let total = intercept + slope * ix;
      // Pas alleen handmatige dips toe (geen automatische seasonality in trend-mode)
      const mIdx = d.getMonth();
      if (mIdx === 11)              total *= (1 - kpis.dipDec     / 100);
      if (mIdx === 6 || mIdx === 7) total *= (1 - kpis.dipBouwvak / 100);
      normal.push(total);  // alles in normal
      event.push(0);
      customers.push(null);
    }
    const details = labels.map((month, idx) => {
      const normalRevenue = normal[idx] || 0;
      const eventRevenue = event[idx] || 0;
      const normalCustomers = customers[idx] ?? null;
      const avgRevenuePerNormal = normalCustomers ? normalRevenue / normalCustomers : 0;
      return {
        month,
        normalRevenue,
        eventRevenue,
        totalRevenue: normalRevenue + eventRevenue,
        normalCustomers,
        avgRevenuePerNormal,
      };
    });
    return { labels, normal, event, customers, details };
  }
  if (forecastMode === 'exp') {
    // Exponentiële groei: op basis van geometrisch gemiddelde MoM uit historie
    const keys = [...historyMonthly.keys()].sort();
    if (keys.length < 3) return { labels: [], normal: [], event: [], customers: [], details: [] };
    const totals = keys.map(k => historyMonthly.get(k).normal + historyMonthly.get(k).event);
    // bereken maand-op-maand ratio's
    const ratios = [];
    for (let i = 1; i < totals.length; i++) {
      const prev = totals[i-1];
      const cur  = totals[i];
      if (prev > 0 && cur > 0) ratios.push(cur / prev);
    }
    if (!ratios.length) return { labels: [], normal: [], event: [], customers: [], details: [] };
    const geo = Math.pow(ratios.reduce((p, r) => p * r, 1), 1 / ratios.length);

    const lastKey = keys[keys.length - 1];
    const [y, m] = lastKey.split('-').map(Number);
    const baseDate = new Date(y, m - 1);
    const keyOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

    // startwaarde = laatste bekende totaal
    let lastTotal = totals[totals.length - 1];
    const labels = [], normal = [], event = [], customers = [];
    for (let i = 1; i <= forecastMonths; i++) {
      const d = new Date(baseDate); d.setMonth(d.getMonth() + i);
      const mIdx = d.getMonth();
      // groei
      lastTotal = lastTotal * geo;
      // dips toepassen zoals KPI-mode (december/bouwvak)
      let projected = lastTotal;
      if (mIdx === 11)              projected *= (1 - kpis.dipDec     / 100);
      if (mIdx === 6 || mIdx === 7) projected *= (1 - kpis.dipBouwvak / 100);
      labels.push(keyOf(d));
      normal.push(projected);
      event.push(0);
      customers.push(null);
    }
    const details = labels.map((month, idx) => {
      const normalRevenue = normal[idx] || 0;
      const eventRevenue = event[idx] || 0;
      const normalCustomers = customers[idx] ?? null;
      const avgRevenuePerNormal = normalCustomers ? normalRevenue / normalCustomers : 0;
      return {
        month,
        normalRevenue,
        eventRevenue,
        totalRevenue: normalRevenue + eventRevenue,
        normalCustomers,
        avgRevenuePerNormal,
      };
    });
    return { labels, normal, event, customers, details };
  }
  // KPI-mode (bestaand)
  /* 1. Baseline-periode bepalen ------------------------------------------ */
  const period = (baselineMode === 'single')
      ? [baselineMonth]
      : getMonthRange(baselineFrom, baselineTo);

  const valid = period.filter(k => historyMonthly.has(k));
  document.getElementById('baselineWarning')
          .classList.toggle('hidden', valid.length > 0);
          const noHist = !valid.length;
  /* 2. Startwaarden ------------------------------------------------------- */
  const normSum = valid.reduce((s, k) => s + historyMonthly.get(k).normal, 0);
  const custSum = valid.reduce((s, k) => {
    const [y, m] = k.split('-').map(Number);
    return s + getActiveNormalCustomerCount(new Date(y, m - 1)); // alleen normale klanten
  }, 0);

  let coreCust     = valid.length ? custSum / valid.length : 0;   // alleen bestaande klanten
  let coreAvgOmzet = valid.length ? normSum / Math.max(1, custSum) : 0;

  // event-omzet per klant
  const eventBase = new Map();
  eventPerClient.forEach((mMap, klant) => {
    const cfg = eventSettings.get(klant);
    // Skip klanten die zijn uitgesloten van target
    if (cfg && cfg.excludeFromTarget) return;
    
    const s = valid.reduce((tot, k) => tot + (mMap.get(k) || 0), 0);
    if (s > 0) eventBase.set(klant, s / valid.length);
  });

  /* 3. Basisdatum voor forecast-start ------------------------------------ */
  // Forecast moet altijd starten NA de laatste beschikbare historische maand.
  // De baseline-periode bepaalt alleen de startwaarden (coreCust/coreAvgOmzet),
  // niet de positie waar de forecast in de tijd begint.
  let baseDate;
  if (historyMonthly.size) {
    const lastKey = [...historyMonthly.keys()].sort().pop();
    const [y, m]  = lastKey.split('-').map(Number);
    baseDate = new Date(y, m - 1);
  } else if (baselineMonth) {
    const [y, m] = baselineMonth.split('-').map(Number);
    baseDate = new Date(y, m - 1);
  } else {
    baseDate = new Date(); // ultiem vangnet
  }

  const keyOf    = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

  const labels = [], normal = [], event = [], customers = [];
  // Absolute mode: houd een groeiende gemiddelde omzet/klant bij
  let absAvg = (customerMode === 'absolute') ? (avgRevenuePerCustomerAbs || 0) : 0;
  // Manual mode: houd een groeiende gemiddelde omzet/klant bij (net zoals absolute mode)
  let manualAvgBase = (customerMode === 'manual') ? (avgRevenuePerCustomerManual || 0) : 0;
  const manualBaselineStart = coreCust;
  const details = [];

  // Seizoensindex uit historie + overrides (12 maandfactoren, genormaliseerd op 1.0)
  let seasonality = Array(12).fill(1);
  if (forecastMode === 'kpi' && useSeasonality) {
    const base = computeSeasonalityFactors(historyMonthly);
    seasonality = base.map((f, i) => (seasonalityOverrides[i] != null ? seasonalityOverrides[i] : f));
  }

  /* 4. 18 maanden vooruit ------------------------------------------------- */
  
  // Check of we een individuele klant forecast doen
  const isIndividualCustomer = selectedCustomer !== '__all';
  const individualSettings = isIndividualCustomer ? individualCustomerSettings.get(selectedCustomer) : null;
  
  // Array om nieuwe klanten per cohort bij te houden (per maand)
  const percentCohorts = [];
  // Voor manual mode: bijhouden van klanten per maand voor onboarding berekening
  const manualCohorts = [];
  // Baseline klanten voor manual mode (gebruikt om te bepalen welke klanten "bestaand" zijn)
  const manualBaselineCustomers = customerMode === 'manual' ? coreCust : 0;
  let previousManualCustomers = manualBaselineCustomers;
  
  for (let i = 1; i <= forecastMonths; i++) {
    const d = new Date(baseDate); d.setMonth(d.getMonth() + i);
    const mIdx = d.getMonth();
    const monthKey = keyOf(d);

  // 1) core-klanten (excl. nieuwe merken)
  // Voor individuele klant: geen churn/newBiz (de klant bestaat gewoon)
  if (!isIndividualCustomer) {
    if (customerMode === 'percent') {
      // Bereken nieuwe klanten voor deze maand (voor cohort)
      const newCustomersThisMonth = coreCust * (kpis.newBiz / 100);
      
      // Voeg toe als nieuw cohort
      if (newCustomersThisMonth > 0) {
        percentCohorts.push({ 
          customers: newCustomersThisMonth, 
          startMonth: i 
        });
      }
      
      // Pas alleen churn toe op bestaande klanten
      coreCust = coreCust * (1 - kpis.churn / 100);
    } else if (customerMode === 'absolute') {
      // absolute mode: churn alleen toepassen als er GEEN nieuwe klanten per maand zijn ingesteld
      // Anders zijn de nieuwe klanten al netto (na churn)
      if (newCustomersPerMonth === 0) {
        coreCust = coreCust * (1 - kpis.churn / 100);
      }
      // Als er nieuwe klanten per maand zijn, blijft coreCust stabiel (baseline) en groeien we via cohorts
      // coreCust blijft gelijk aan baseline, alle nieuwe klanten komen via cohorts
    } else if (customerMode === 'manual') {
      const manualRaw = manualCustomerPlan.get(monthKey);
      const manualVal = Number(manualRaw);
      if (Number.isFinite(manualVal) && manualVal >= 0) {
        coreCust = manualVal;
        // Bereken nieuwe klanten voor onboarding (verschil met vorige maand)
        const newCustomersThisMonth = Math.max(0, coreCust - previousManualCustomers);
        if (newCustomersThisMonth > 0) {
          manualCohorts.push({
            customers: newCustomersThisMonth,
            startMonth: i
          });
        }
        previousManualCustomers = coreCust;
      } else {
        // Als geen waarde is ingesteld, gebruik laatste bekende waarde
        coreCust = previousManualCustomers;
      }
    }
  }
    
            /* ---- extra klanten van nieuwe merken ---- */
            let newBrandRevenue = 0;

            newSuppliers.forEach(b => {
              // churn op bestaande populatie
              b.cumCust = b.cumCust * (1 - kpis.churn / 100);
            
              // nieuwe klanten vanaf startmaand
              if (monthKey >= b.start) b.cumCust += b.newCust;
            
              // eigen omzetgroei & dips
              b.curRev *= (1 + kpis.growth / 100);
              let brandAvg = b.curRev;
              if (mIdx === 11)              brandAvg *= (1 - kpis.dipDec     / 100);
              if (mIdx === 6 || mIdx === 7) brandAvg *= (1 - kpis.dipBouwvak / 100);
            
              newBrandRevenue += b.cumCust * brandAvg;
            });
            const brandCustTotal = newSuppliers.reduce((s, b) => s + b.cumCust, 0);
            

    /* totaal klanten aanvullen met nieuwe merken */
                  
                  
  
// 2) omzet­groei & seizoensdips voor core
// Voor individuele klant: gebruik individuele growth setting
const growthRate = isIndividualCustomer && individualSettings 
  ? individualSettings.growth 
  : kpis.growth;

coreAvgOmzet *= (1 + growthRate / 100);
if (customerMode === 'absolute' && absAvg > 0) {
  absAvg *= (1 + growthRate / 100); // Cumulatieve groei
}
// Voor manual mode: pas ook cumulatieve groei toe (net zoals absolute mode)
if (customerMode === 'manual' && manualAvgBase > 0) {
  manualAvgBase *= (1 + growthRate / 100); // Cumulatieve groei, net zoals absAvg
}

// (moved to top-level)
let monthAvg  = (customerMode === 'absolute' && absAvg > 0)
  ? absAvg
  : (customerMode === 'manual' && manualAvgBase > 0)
  ? manualAvgBase
  : coreAvgOmzet;

// Voor individuele klant: pas structurele wijziging toe indien ingesteld
if (isIndividualCustomer && individualSettings && individualSettings.changeMonth && monthKey >= individualSettings.changeMonth) {
  monthAvg *= (1 + (individualSettings.changePct || 0) / 100);
}

// Dips en seasonality (voor beide modes)
if (mIdx === 11)              monthAvg *= (1 - kpis.dipDec     / 100);
if (mIdx === 6 || mIdx === 7) monthAvg *= (1 - kpis.dipBouwvak / 100);
if (forecastMode === 'kpi' && useSeasonality) monthAvg *= seasonality[mIdx];

// 3) omzet berekenen
// In absolute mode met nieuwe klanten: coreCust = baseline, nieuwe klanten komen via cohorts
// In manual mode: coreCust = handmatige invoer (totaal), maar we moeten baseline + cohorts scheiden
let coreRevenue   = coreCust * monthAvg;
let cohortCustomersTotal = 0;


// Bereken onboarding curve parameters (gebruikt door beide modes)
const baseRamp = [0.10, 0.40, 0.80]; // maand 0..2; maand 3+ = 100%
const gain = Math.max(0.5, Math.min(2, onboardingCurve));
const ramp = baseRamp.map(v => Math.max(0, Math.min(1, Math.pow(v, 1 / gain))));

// Absolute mode: voeg omzet van alle bestaande cohorts toe met onboarding-ramp
if (customerMode === 'absolute' && newCustomersPerMonth > 0) {
  // coreCust is hier de baseline (blijft stabiel)
  // Alle nieuwe klanten komen via cohorts met onboarding
  const partialSum = ramp.slice(0, Math.min(3, i)).reduce((s, v, idx) => s + v, 0);
  const fullyOnboardedCount = Math.max(0, i - 3);
  const multiplier = fullyOnboardedCount + partialSum; // totale factor over i cohorts
  const cohortRevenue = newCustomersPerMonth * monthAvg * multiplier;
  // coreRevenue bevat al baseline omzet (coreCust * monthAvg), voeg cohort omzet toe
  coreRevenue += cohortRevenue;
  cohortCustomersTotal = i * newCustomersPerMonth;
}

// Percent mode: voeg omzet van alle cohorts toe met onboarding-ramp
if (customerMode === 'percent' && percentCohorts.length > 0) {
  let percentCohortRevenue = 0;
  let percentCohortCustomers = 0;
  
  percentCohorts.forEach(cohort => {
    const cohortAge = i - cohort.startMonth; // hoeveel maanden geleden is dit cohort gestart?
    if (cohortAge >= 0) { // alleen cohorts die al gestart zijn
      let onboardingFactor;
      if (cohortAge >= 3) {
        onboardingFactor = 1.0; // volledig onboard
      } else {
        onboardingFactor = ramp[cohortAge]; // gebruik ramp voor eerste 3 maanden
      }
      percentCohortRevenue += cohort.customers * monthAvg * onboardingFactor;
      percentCohortCustomers += cohort.customers;
    }
  });
  
  coreRevenue += percentCohortRevenue;
  cohortCustomersTotal = percentCohortCustomers;
}

// Manual mode: bereken omzet zoals in absolute mode
// In manual mode is coreCust het totaal aantal klanten per maand (handmatige invoer)
// We moeten de omzet berekenen alsof alle klanten via cohorts zijn toegevoegd met onboarding
// Net zoals in absolute mode: baseline klanten krijgen volledige omzet, nieuwe klanten krijgen onboarding
if (customerMode === 'manual') {
  const baselineRevenue = manualBaselineCustomers * monthAvg;
  let manualCohortRevenue = 0;
  let manualCohortCustomers = 0;
  
  // Als er cohorts zijn, bereken omzet zoals in absolute mode
  if (manualCohorts.length > 0) {
    // Gebruik dezelfde multiplier berekening als absolute mode
    const partialSum = ramp.slice(0, Math.min(3, i)).reduce((s, v, idx) => s + v, 0);
    const fullyOnboardedCount = Math.max(0, i - 3);
    const multiplier = fullyOnboardedCount + partialSum; // totale factor over i cohorts
    
    // Bereken cohort revenue zoals in absolute mode
    // Maar alleen voor de cohorts die daadwerkelijk zijn toegevoegd
    const totalNewCustomers = manualCohorts.reduce((sum, c) => {
      const cohortAge = i - c.startMonth;
      return sum + (cohortAge >= 0 ? c.customers : 0);
    }, 0);
    
    // Als alle cohorts hetzelfde aantal klanten hebben (zoals bij constante groei),
    // gebruik dan de multiplier methode zoals absolute mode
    const allCohortsSameSize = manualCohorts.every(c => c.customers === manualCohorts[0].customers);
    
    if (allCohortsSameSize && manualCohorts.length > 0) {
      // Gebruik exact dezelfde berekening als absolute mode
      const newCustomersPerMonth = manualCohorts[0].customers;
      manualCohortRevenue = newCustomersPerMonth * monthAvg * multiplier;
      manualCohortCustomers = totalNewCustomers;
    } else {
      // Als cohorts verschillende groottes hebben, bereken individueel
      manualCohorts.forEach(cohort => {
        const cohortAge = i - cohort.startMonth;
        if (cohortAge >= 0) {
          let onboardingFactor;
          if (cohortAge >= 3) {
            onboardingFactor = 1.0;
          } else {
            onboardingFactor = ramp[cohortAge];
          }
          const cohortRev = cohort.customers * monthAvg * onboardingFactor;
          manualCohortRevenue += cohortRev;
          manualCohortCustomers += cohort.customers;
        }
      });
    }
  }
  
  // Vervang coreRevenue met baseline omzet + cohort omzet (net zoals absolute mode)
  coreRevenue = baselineRevenue + manualCohortRevenue;
  cohortCustomersTotal = manualCohortCustomers;
}

const totalRevenue  = coreRevenue + newBrandRevenue;
// In manual mode is coreCust al het totale aantal klanten per maand (handmatige invoer)
// De cohorts worden alleen gebruikt voor onboarding-omzet berekening, niet voor klantentelling
const totalCustomers = (customerMode === 'manual')
  ? coreCust + brandCustTotal  // In manual mode: alleen coreCust + nieuwe merken
  : coreCust + brandCustTotal + cohortCustomersTotal;  // In andere modes: tel cohorts mee

    /* ---- event-klanten ---- */
    let evSum = 0;
    eventBase.forEach((start, klant) => {
      const cfg = eventSettings.get(klant) || { growth: 0, stop: '', changeMonth: '', changePct: 0 };
      
      // Skip klanten die zijn uitgesloten van target
      if (cfg.excludeFromTarget) return;
      
      if (cfg.stop && monthKey >= cfg.stop) return;           // gestopt

      const growthFactor = Math.pow(1 + cfg.growth / 100, i);
      let evVal = start * growthFactor;
      
      // Pas structurele wijziging toe vanaf specifieke maand
      if (cfg.changeMonth && monthKey >= cfg.changeMonth) {
        evVal *= (1 + (cfg.changePct || 0) / 100);
      }
      if (mIdx === 11)              evVal *= (1 - kpis.dipDec     / 100);
      if (mIdx === 6 || mIdx === 7) evVal *= (1 - kpis.dipBouwvak / 100);
      if (forecastMode === 'kpi' && useSeasonality) evVal *= seasonality[mIdx];
      evSum += evVal;
    });

    // Voor individuele klant: check of deze maand moet worden overgeslagen
    let finalRevenue = totalRevenue;
    if (isIndividualCustomer && individualSettings && individualSettings.skipMonths) {
      if (individualSettings.skipMonths.includes(monthKey)) {
        finalRevenue = 0; // Zet omzet op 0 voor deze maand
      }
    }


    const normalCustomersCount = Math.max(0, totalCustomers);
    const averagePerNormal = normalCustomersCount > 0 ? finalRevenue / normalCustomersCount : 0;
    const totalRevenueCombined = finalRevenue + evSum;

    labels.push(monthKey);
    normal.push(finalRevenue);
    event.push(evSum);
    customers.push(totalCustomers);
    details.push({
      month: monthKey,
      normalRevenue: finalRevenue,
      eventRevenue: evSum,
      totalRevenue: totalRevenueCombined,
      normalCustomers: normalCustomersCount,
      avgRevenuePerNormal: averagePerNormal
    });

  }
  if (customerMode === 'manual') {
    manualPlanMonths = labels.slice();
    manualPlanBaseline = Math.round(manualBaselineStart || 0);
  } else {
    manualPlanMonths = [];
    manualPlanBaseline = 0;
  }
  
  return { labels, normal, event, customers, details };
}


// dummy helper voor actieve klanten (simple unique count)
function getActiveCustomerCount(dateObj) {
  const key = `${dateObj.getFullYear()}-${String(dateObj.getMonth()+1).padStart(2,'0')}`;
  let rows = selectedSupplier === '__all' ? rawRows : rawRows.filter(r=>r.Leverancier===selectedSupplier);
  
  // Segment filter toepassen
  if (selectedSegment !== '__all') {
    if (selectedSegment === 'ci') {
      rows = rows.filter(r => ciArtikelen.has(r.Artikel));
    } else if (selectedSegment === 'residentieel') {
      rows = rows.filter(r => !ciArtikelen.has(r.Artikel));
    }
  }
  
  if (selectedArtikelgroep !== '__all') {
    rows = rows.filter(r => r.Artikelgroep === selectedArtikelgroep);
  }
  
  if (selectedCountry !== '__all') {
    rows = rows.filter(r => (r.land ?? r.Land) === selectedCountry);
  }
  
  if (selectedCustomer !== '__all') {
    rows = rows.filter(r => r['Besteld door'] === selectedCustomer);
  }
  
  const custSet = new Set(rows.filter(r =>
    `${r.Jaar}-${String(r.Maand).padStart(2,'0')}` === key).map(r => r['Besteld door']));
  return custSet.size;
}

const baselinePanel = document.getElementById('baselinePanel');
baselinePanel.addEventListener('input', (e) => {
  // Skip seizoensindex inputs - die hebben hun eigen update button
  if (e.target.closest('#seasonalityInputs')) {
    return;
  }
  
  baselineMode  = baselinePanel.querySelector('input[name="baselineMode"]:checked').value;
  baselineMonth = baselinePanel.querySelector('#baselineMonth').value;
  baselineFrom  = baselinePanel.querySelector('#baselineFrom').value;
  baselineTo    = baselinePanel.querySelector('#baselineTo').value;
  forecastMode  = baselinePanel.querySelector('input[name="forecastMode"]:checked').value; // ▼ nieuw
  useSeasonality = document.getElementById('useSeasonality').checked; // ▼ nieuw
  customerMode  = baselinePanel.querySelector('input[name="customerMode"]:checked').value; // ▼ nieuw
  newCustomersPerMonth = Number(document.getElementById('newCustomersPerMonth').value) || 0;
  avgRevenuePerCustomerAbs = Number(document.getElementById('avgRevenuePerCustomerAbs').value) || 0;
  const avgRevenuePerCustomerManualEl = document.getElementById('avgRevenuePerCustomerManual');
  if (avgRevenuePerCustomerManualEl) {
    avgRevenuePerCustomerManual = Number(avgRevenuePerCustomerManualEl.value) || 0;
  }
  showExtraYears = !!document.getElementById('showExtraYears')?.checked;
  // horizon bijwerken
  forecastMonths = computeForecastMonths();
  if (customerMode !== 'percent') { kpis.newBiz = 0; }
  // Toon/verberg absolute config
  document.getElementById('absoluteCustomerConfig').classList.toggle('hidden', customerMode !== 'absolute');
  if (manualCustomerContainer) {
    manualCustomerContainer.classList.toggle('hidden', customerMode !== 'manual');
    if (customerMode === 'manual') {
      renderManualCustomerConfig(manualPlanMonths, manualPlanBaseline);
    }
  }
  buildKpiPanel();
  renderChart();
});

// Zorg dat checkbox/radios ook bij 'change' meteen renderen
baselinePanel.addEventListener('change', () => {
  baselineMode  = baselinePanel.querySelector('input[name="baselineMode"]:checked').value;
  baselineMonth = baselinePanel.querySelector('#baselineMonth').value;
  baselineFrom  = baselinePanel.querySelector('#baselineFrom').value;
  baselineTo    = baselinePanel.querySelector('#baselineTo').value;
  forecastMode  = baselinePanel.querySelector('input[name="forecastMode"]:checked').value;
  useSeasonality = document.getElementById('useSeasonality').checked;
  customerMode  = baselinePanel.querySelector('input[name="customerMode"]:checked').value;
  newCustomersPerMonth = Number(document.getElementById('newCustomersPerMonth').value) || 0;
  avgRevenuePerCustomerAbs = Number(document.getElementById('avgRevenuePerCustomerAbs').value) || 0;
  const avgRevenuePerCustomerManualEl = document.getElementById('avgRevenuePerCustomerManual');
  if (avgRevenuePerCustomerManualEl) {
    avgRevenuePerCustomerManual = Number(avgRevenuePerCustomerManualEl.value) || 0;
  }
  showExtraYears = !!document.getElementById('showExtraYears')?.checked;
  forecastMonths = computeForecastMonths();
  if (customerMode !== 'percent') { kpis.newBiz = 0; }
  document.getElementById('absoluteCustomerConfig').classList.toggle('hidden', customerMode !== 'absolute');
  if (manualCustomerContainer) {
    manualCustomerContainer.classList.toggle('hidden', customerMode !== 'manual');
    if (customerMode === 'manual') {
      renderManualCustomerConfig(manualPlanMonths, manualPlanBaseline);
    }
  }
  buildKpiPanel();
  renderChart();
});

// unieke normale klanten (event-klanten en excluded klanten uitgesloten)
function getActiveNormalCustomerCount(dateObj) {
  const key = `${dateObj.getFullYear()}-${String(dateObj.getMonth()+1).padStart(2,'0')}`;
  let rows = selectedSupplier === '__all'
    ? rawRows
    : rawRows.filter(r => r.Leverancier === selectedSupplier);

  // Segment filter toepassen
  if (selectedSegment !== '__all') {
    if (selectedSegment === 'ci') {
      rows = rows.filter(r => ciArtikelen.has(r.Artikel));
    } else if (selectedSegment === 'residentieel') {
      rows = rows.filter(r => !ciArtikelen.has(r.Artikel));
    }
  }

  if (selectedArtikelgroep !== '__all') {
    rows = rows.filter(r => r.Artikelgroep === selectedArtikelgroep);
  }

  if (selectedCountry !== '__all') {
    rows = rows.filter(r => (r.land ?? r.Land) === selectedCountry);
  }

  if (selectedCustomer !== '__all') {
    rows = rows.filter(r => r['Besteld door'] === selectedCustomer);
  }

  const set = new Set(
    rows.filter(r => {
      const klant = r['Besteld door'];
      const cfg = eventSettings.get(klant);
      const excludeFromTarget = cfg && cfg.excludeFromTarget;
      return `${r.Jaar}-${String(r.Maand).padStart(2,'0')}` === key &&
             !eventCustomers.has(klant) &&
             !excludeFromTarget;
    }).map(r => r['Besteld door'])
  );
  return set.size;
}



/* -------------  CHART.JS SETUP ------------- */
let chart;           // omzet-stack
let customerChart;   // klanten-grafiek
let ordersChart;     // orders per dag lijn
const newSuppliers = [];          // ▼ nieuw – array met extra merken

function formatRevenueLabel(label, grouping = 'month') {
  if (!label) return '';
  if (grouping === 'year') {
    return String(label).split('-')[0] || String(label);
  }
  if (grouping === 'quarter') {
    const [yearStr, monthStr = '01'] = String(label).split('-');
    const month = Math.max(1, Math.min(12, Number(monthStr)));
    const quarter = Math.floor((month - 1) / 3) + 1;
    return `${yearStr}-Q${quarter}`;
  }
  return String(label);
}

function aggregateTimeline(labels, seriesList, grouping = 'month') {
  const safeLabels = Array.isArray(labels) ? labels : [];
  const safeSeries = Array.isArray(seriesList) ? seriesList : [];
  if (!safeSeries.length) {
    return { labels: safeLabels.slice(), series: [] };
  }
  if (!safeLabels.length) {
    return { labels: [], series: safeSeries.map(() => []) };
  }

  const aggregatedLabels = [];
  const labelIndexMap = new Map();
  const aggregatedSeries = safeSeries.map(() => []);
  const valueCounts = safeSeries.map(() => []);

  safeLabels.forEach((label, rowIdx) => {
    const bucketKey = formatRevenueLabel(label, grouping);
    let bucketIdx = labelIndexMap.get(bucketKey);
    if (bucketIdx === undefined) {
      bucketIdx = aggregatedLabels.length;
      aggregatedLabels.push(bucketKey);
      labelIndexMap.set(bucketKey, bucketIdx);
      aggregatedSeries.forEach(arr => arr.push(0));
      valueCounts.forEach(arr => arr.push(0));
    }
    safeSeries.forEach((series, seriesIdx) => {
      const value = series[rowIdx];
      if (value == null) return;
      aggregatedSeries[seriesIdx][bucketIdx] += value;
      valueCounts[seriesIdx][bucketIdx] += 1;
    });
  });

  aggregatedSeries.forEach((series, seriesIdx) => {
    series.forEach((val, idx) => {
      if (valueCounts[seriesIdx][idx] === 0) {
        series[idx] = null;
      }
    });
  });

  return { labels: aggregatedLabels, series: aggregatedSeries };
}

function buildScenarioSeriesForGrouping(scenario, targetLabels, fallbackSeries) {
  const safeTargetLabels = Array.isArray(targetLabels) ? targetLabels : [];
  if (!scenario) {
    return fallbackSeries ? fallbackSeries.slice() : safeTargetLabels.map(() => null);
  }
  const hasExplicitLabels = Array.isArray(scenario.labels) && scenario.labels.length > 0;
  const sourceLabels = hasExplicitLabels
    ? scenario.labels
    : Object.keys(scenario.valueByLabel || {});
  if (!sourceLabels.length) {
    return fallbackSeries ? fallbackSeries.slice() : safeTargetLabels.map(() => null);
  }
  const sourceValues = sourceLabels.map(label => {
    const raw = scenario.valueByLabel ? scenario.valueByLabel[label] : null;
    const num = Number(raw);
    return Number.isFinite(num) ? num : null;
  });
  const { labels: scenarioBuckets, series } = aggregateTimeline(sourceLabels, [sourceValues], revenueGrouping);
  const aggregatedScenarioValues = (series[0] || []).slice();
  const lookup = new Map();
  scenarioBuckets.forEach((label, idx) => {
    const val = aggregatedScenarioValues[idx];
    if (val != null) {
      lookup.set(label, val);
    }
  });
  return safeTargetLabels.map((label, idx) => {
    if (lookup.has(label)) {
      return lookup.get(label);
    }
    return fallbackSeries ? fallbackSeries[idx] ?? null : null;
  });
}

function renderChart() {
  if (!rawRows.length) return;

  let filteredRows = selectedSupplier === '__all'
    ? rawRows
    : rawRows.filter(r => r.Leverancier === selectedSupplier);

  // Segment filter toepassen
  if (selectedSegment !== '__all') {
    if (selectedSegment === 'ci') {
      filteredRows = filteredRows.filter(r => ciArtikelen.has(r.Artikel));
    } else if (selectedSegment === 'residentieel') {
      filteredRows = filteredRows.filter(r => !ciArtikelen.has(r.Artikel));
    }
  }

  // Artikelgroepfilter toepassen
  if (selectedArtikelgroep !== '__all') {
    filteredRows = filteredRows.filter(r => r.Artikelgroep === selectedArtikelgroep);
  }

  // Landfilter toepassen
  if (selectedCountry !== '__all') {
    filteredRows = filteredRows.filter(r => (r.land ?? r.Land) === selectedCountry);
  }

  // Klantfilter toepassen
  if (selectedCustomer !== '__all') {
    filteredRows = filteredRows.filter(r => r['Besteld door'] === selectedCustomer);
  }

  // Datumfilter toepassen
  if (dateFilterFrom || dateFilterTo) {
    filteredRows = filteredRows.filter(r => {
      const rowDate = `${r.Jaar}-${String(r.Maand).padStart(2, '0')}`;
      if (dateFilterFrom && rowDate < dateFilterFrom) return false;
      if (dateFilterTo && rowDate > dateFilterTo) return false;
      return true;
    });
  }

/* ---------- HISTORISCHE OMZET ---------- */
const monthly       = new Map();                    // 'YYYY-MM' → { normal, event, eventPerClient }
const eventByClient = new Map();                    // klant → Map(maand → bedrag)

// Geen historische rijen voor nieuwe merken → fallback op lege dataset
if (!rawRows.some(r => r.Leverancier === selectedSupplier) &&
    newSuppliers.every(ns => ns.name !== selectedSupplier)) {
  selectedSupplier = '__all';
  supplierSelect.value = '__all';
}

filteredRows.forEach(r => {
  const key = `${r.Jaar}-${String(r.Maand).padStart(2, '0')}`;
  if (!monthly.has(key)) monthly.set(key, { normal: 0, event: 0, eventPerClient: new Map() });

  const klant = r['Besteld door'];
  const isEvent = eventCustomers.has(klant);
  const cfg = eventSettings.get(klant);
  const excludeFromTarget = cfg && cfg.excludeFromTarget;
  
  // Als klant is uitgesloten van target: volledig overslaan
  if (excludeFromTarget) {
    return; // Skip deze klant volledig
  }
  
  // Anders: normale verwerking
  const bucket = isEvent ? 'event' : 'normal';
  monthly.get(key)[bucket] += Number(r.Factuurbedrag) || 0;

  if (isEvent) {
    // Voeg toe aan eventByClient
    if (!eventByClient.has(klant))
      eventByClient.set(klant, new Map());
    const cMap = eventByClient.get(klant);
    cMap.set(key, (cMap.get(key) || 0) + (Number(r.Factuurbedrag) || 0));
    
    // Voeg ook toe aan monthly.eventPerClient voor seizoensindex
    const monthData = monthly.get(key);
    monthData.eventPerClient.set(klant, (monthData.eventPerClient.get(klant) || 0) + (Number(r.Factuurbedrag) || 0));
  }
});

const histLabels = [...monthly.keys()].sort();
  // bewaar globaal voor horizon-berekening
  try { window.latestMonthlyKeys = histLabels; } catch {}
const histNormal = histLabels.map(k => monthly.get(k).normal);
const histEvent  = histLabels.map(k => monthly.get(k).event);
const histTotal  = histLabels.map((k, i) => histNormal[i] + histEvent[i]);

  /* ---------- FORECAST ---------- */
  const fc = calcForecast(monthly, eventByClient);
  if (customerMode === 'manual') {
    renderManualCustomerConfig(manualPlanMonths, manualPlanBaseline);
  } else if (manualCustomerContainer) {
    manualCustomerContainer.classList.add('hidden');
  }

  // Seizoenseditor updaten (basis op historie) als actief
  try {
    if (useSeasonality && forecastMode === 'kpi') {
      const baseFactors = computeSeasonalityFactors(monthly);
      renderSeasonalityInputs(baseFactors);
    } else {
      const box = document.getElementById('seasonalityBox');
      if (box) box.classList.add('hidden');
    }
  } catch {}

  // Datumfilter toepassen op forecast labels
  let filteredFcLabels = fc.labels;
  let filteredFcNormal = fc.normal;
  let filteredFcEvent = fc.event;
  
  let selectedFcIndices = fc.labels.map((_, index) => index);
  if (dateFilterFrom || dateFilterTo) {
    const filteredIndices = [];
    fc.labels.forEach((label, index) => {
      if (dateFilterFrom && label < dateFilterFrom) return;
      if (dateFilterTo && label > dateFilterTo) return;
      filteredIndices.push(index);
    });
    selectedFcIndices = filteredIndices;
    filteredFcLabels = filteredIndices.map(i => fc.labels[i]);
    filteredFcNormal = filteredIndices.map(i => fc.normal[i]);
    filteredFcEvent = filteredIndices.map(i => fc.event[i]);
  }

  if (avgRevenueBox) {
    let totalForecastRevenue = 0;
    let totalForecastCustomers = 0;
    selectedFcIndices.forEach(idx => {
      const revenue = fc.normal[idx];
      const customersCount = fc.customers[idx];
      if (revenue != null && customersCount != null && customersCount > 0) {
        totalForecastRevenue += revenue;
        totalForecastCustomers += customersCount;
      }
    });
    if (totalForecastCustomers > 0) {
      const avgForecast = totalForecastRevenue / totalForecastCustomers;
      avgRevenueBox.textContent = `Gemiddelde omzet per normale klant (forecast): ${euro(avgForecast)}`;
      avgRevenueBox.classList.remove('text-gray-500');
    } else {
      avgRevenueBox.textContent = 'Gemiddelde omzet per normale klant: n.v.t.';
      avgRevenueBox.classList.add('text-gray-500');
    }
  }

  const combinedLabels = [...histLabels, ...filteredFcLabels];
  const histLength = histLabels.length;
  const histNormalSeries = combinedLabels.map((_, idx) => idx < histLength ? histNormal[idx] : null);
  const histEventSeries = combinedLabels.map((_, idx) => idx < histLength ? histEvent[idx] : null);
  const fcNormalSeries = combinedLabels.map((_, idx) => {
    if (idx < histLength) return null;
    const fcIdx = idx - histLength;
    return filteredFcNormal[fcIdx] ?? null;
  });
  const fcEventSeries = combinedLabels.map((_, idx) => {
    if (idx < histLength) return null;
    const fcIdx = idx - histLength;
    return filteredFcEvent[fcIdx] ?? null;
  });

  const totalValueByLabel = new Map();
  histLabels.forEach((label, idx) => {
    const val = histTotal[idx];
    if (Number.isFinite(val)) totalValueByLabel.set(label, val);
  });
  filteredFcLabels.forEach((label, idx) => {
    const val = (filteredFcNormal[idx] ?? 0) + (filteredFcEvent[idx] ?? 0);
    if (Number.isFinite(val)) totalValueByLabel.set(label, val);
  });

  const scenarioBaseSeries = combinedLabels.map(label => {
    const val = totalValueByLabel.get(label);
    return Number.isFinite(val) ? val : null;
  });

  lastScenarioCapture = {
    labels: [...combinedLabels],
    series: scenarioBaseSeries.slice(),
    valueByLabel: Object.fromEntries(
      [...totalValueByLabel.entries()].map(([k, v]) => [k, Number.isFinite(v) ? Number(v) : null])
    ),
  };
  // Orders per dag functionaliteit verwijderd
  // const ordersData = computeOrdersPerDayData(
  //   filteredRows,
  //   filteredFcLabels,
  //   filteredFcNormal,
  //   filteredFcEvent
  // );
  // updateOrdersPerDayChart(ordersData);

  const aggregationInput = [histNormalSeries, histEventSeries, fcNormalSeries, fcEventSeries, scenarioBaseSeries];
  const { labels: revenueLabels, series: aggregatedSeries } =
    aggregateTimeline(combinedLabels, aggregationInput, revenueGrouping);
  const [
    aggregatedHistNormal = [],
    aggregatedHistEvent = [],
    aggregatedFcNormal = [],
    aggregatedFcEvent = [],
    aggregatedScenarioBase = [],
  ] = aggregatedSeries;

  /* ---------- DATASETS ---------- */
  const datasets = [];
  if (showStackedBars) {
    datasets.push(
      {
        label: 'Normale klanten (historisch)',
        data: aggregatedHistNormal,
        backgroundColor: '#3182ce',
        stack: 'hist',
      },
      {
        label: 'Event-klanten (historisch)',
        data: aggregatedHistEvent,
        backgroundColor: '#63b3ed',
        stack: 'hist',
      },
      {
        label: 'Normale klanten (forecast)',
        data: aggregatedFcNormal,
        backgroundColor: 'rgba(49,130,206,0.35)',
        stack: 'fc',
      },
      {
        label: 'Event-klanten (forecast)',
        data: aggregatedFcEvent,
        backgroundColor: 'rgba(99,179,237,0.35)',
        stack: 'fc',
      },
    );
  }

  // Trendlijn over historische totalen (lijn) + projectie
  let trendStats = null;
  if (histLabels.length >= 2) {
    const x = histLabels.map((_, i) => i);
    const { slope, intercept } = computeLinearRegression(x, histTotal);
    trendStats = { slope, intercept };

    if (showTrendline) {
      const trendLine = x.map(ix => intercept + slope * ix);
      const projLen = filteredFcLabels.length;

      datasets.push({
        type: 'line',
        label: 'Trendlijn (historisch)',
        data: trendLine,
        borderColor: '#ef4444',
        backgroundColor: 'transparent',
        borderWidth: 2,
        pointRadius: 0,
        yAxisID: 'y',
        order: 0,
        stack: 'trendline',
      });

      // Projectie voortzetten vanaf laatste historische index
      const proj = Array(histLabels.length + projLen).fill(null);
      for (let j = 1; j <= projLen; j++) {
        const ix = histLabels.length - 1 + j;
        proj[histLabels.length - 1 + j] = intercept + slope * ix;
      }
      datasets.push({
        type: 'line',
        label: 'Trendlijn (projectie)',
        data: Array(histLabels.length - 1).fill(null).concat(proj.slice(histLabels.length - 1)),
        borderColor: '#ef4444',
        backgroundColor: 'transparent',
        borderDash: [6, 6],
        borderWidth: 2,
        pointRadius: 0,
        yAxisID: 'y',
        order: 0,
        stack: 'trendline',
      });
    }
  }

  // Marktgroei berekenen en toevoegen
  if (showMarketGrowth && marketGrowthRate > 0 && histTotal.length > 0) {
    // Startwaarde is de eerste historische omzet (eerste zichtbare waarde)
    const startValue = histTotal[0];
    if (startValue > 0) {
      const growthFactor = 1 + (marketGrowthRate / 100);
      
      // Bereken marktgroei voor alle labels (historisch + forecast)
      // Start vanaf index 0 van de gecombineerde labels
      const marketGrowthData = combinedLabels.map((_, index) => {
        return startValue * Math.pow(growthFactor, index);
      });
      
      // Aggregeer voor de gekozen grouping (net zoals de andere data)
      const { labels: marketLabels, series: marketSeries } = 
        aggregateTimeline(combinedLabels, [marketGrowthData], revenueGrouping);
      
      // Align market growth data with revenue labels
      const marketGrowthAligned = revenueLabels.map((label) => {
        const marketIdx = marketLabels.indexOf(label);
        return marketIdx >= 0 && marketSeries[0] ? marketSeries[0][marketIdx] : null;
      });
      
      datasets.push({
        type: 'line',
        label: `Marktgroei (${marketGrowthRate}%/maand)`,
        data: marketGrowthAligned,
        borderColor: '#10b981',
        backgroundColor: 'transparent',
        borderWidth: 2,
        borderDash: [5, 5],
        pointRadius: 2,
        pointHoverRadius: 4,
        yAxisID: 'y',
        order: 1,
        stack: 'marketgrowth',
      });
    }
  }

  if (scenarios.length) {
    const scenarioDatasets = scenarios
      .filter(s => s.visible)
      .map(scenario => {
        const data = buildScenarioSeriesForGrouping(
          scenario,
          revenueLabels,
          aggregatedScenarioBase.length ? aggregatedScenarioBase : revenueLabels.map(() => null)
        );
        return {
          type: 'line',
          label: `Scenario: ${scenario.name}`,
          data,
          borderColor: scenario.color,
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 2,
          pointHoverRadius: 4,
          fill: false,
          spanGaps: true,
          tension: 0.25,
          yAxisID: 'y',
          order: 0,
          stack: `scenario-${scenario.id}`,
        };
      });
    datasets.push(...scenarioDatasets);
  }

  /* ---------- HISTORISCH KLANTENSETS ---------- */
const customerSets = histLabels.map(k => {
  const [y, m] = k.split('-').map(Number);
  const rowsM = filteredRows.filter(r =>
    r.Jaar === y && r.Maand === m && !eventCustomers.has(r['Besteld door']));
  return new Set(rowsM.map(r => r['Besteld door']));
});

/* Churn & new-biz % per maand */
const churnPerc = [], newBizPerc = [];
customerSets.forEach((set, i) => {
  // ---- churn (% van maand i-3) ----
  if (i >= 3) {
    const base = customerSets[i - 3];
    const lost = new Set([...base]);
    [i - 2, i - 1, i].forEach(idx =>
      customerSets[idx].forEach(c => lost.delete(c)));
    churnPerc[i] = base.size ? (lost.size / base.size) * 100 : 0;
  } else churnPerc[i] = null;

  // ---- new business (% van maand i) ----
  const newcomers = new Set([...set]);
  [i - 1, i - 2, i - 3].forEach(idx => {
    if (idx >= 0) customerSets[idx].forEach(c => newcomers.delete(c));
  });
  newBizPerc[i] = set.size ? (newcomers.size / set.size) * 100 : 0;
});

/* Gemiddelde laatste 3 maanden */
   const avg = arr => {
    const last3 = arr.slice(-3).filter(v => v != null);
    return last3.length ? last3.reduce((s, v) => s + v, 0) / last3.length : 0;
  };
  

  /* ---------- CHART.JS (update in plaats van destroy) ---------- */
  if (chart) {
    chart.data.labels = revenueLabels;
    chart.data.datasets = datasets;
    // Voor mixed chart types (bar + line) moet de chart volledig worden geüpdatet
    chart.update();
    if (trendStats) {
      chart.$trendStats = trendStats;
    } else if (!showTrendline) {
      chart.$trendStats = chart.$trendStats || null;
    }
  } else {
    chart = new Chart(ctx, {
      type: 'bar',
      data: { labels: revenueLabels, datasets },
      options: {
        responsive: true,
        plugins: {
          tooltip: { mode: 'index', intersect: false },
          legend: { position: 'bottom' },
        },
        scales: {
          x: { stacked: true },
          y: { stacked: true, beginAtZero: true },
        },
      },
    });
    if (trendStats) {
      chart.$trendStats = trendStats;
    } else {
      chart.$trendStats = chart.$trendStats || null;
    }
  }

  /* ---------- KLANTENTELLING GRAFIEK ---------- */
const histCustCounts = histLabels.map(k => {
  const [y, m] = k.split('-').map(Number);
  return getActiveNormalCustomerCount(new Date(y, m - 1));
});
const custPad = Array(histLabels.length).fill(null);
// Datumfilter toepassen op forecast customers
let filteredFcCustomers = fc.customers;
if (dateFilterFrom || dateFilterTo) {
  filteredFcCustomers = selectedFcIndices.map(i => fc.customers[i]);
}

const custDatasets = [
  {
    label: 'Normale klanten (historisch)',
    data: histCustCounts,
    backgroundColor: '#38a169',
    stack: 'hist',
  },
  {
    label: 'Normale klanten (forecast)',
    data: [...custPad, ...filteredFcCustomers.map(v => v != null ? Math.round(v) : null)],
    backgroundColor: 'rgba(56,161,105,0.35)',
    stack: 'fc',
  },
];

/* ---- omzet per klant ---- */
const revPerCust = histLabels.map((k, i) =>
  histCustCounts[i] ? histNormal[i] / histCustCounts[i] : 0);
const avgRev = avg(revPerCust);   
updateHistoricalBadges(avg(churnPerc), avg(newBizPerc), avgRev);


const cctx = document.getElementById('customerCountChart');
if (customerChart) {
  customerChart.data.labels = combinedLabels;
  customerChart.data.datasets = custDatasets;
  customerChart.update();
} else {
  customerChart = new Chart(cctx, {
    type: 'bar',
    data: { labels: combinedLabels, datasets: custDatasets },
    options: {
      responsive: true,
      plugins: {
        tooltip: { 
          mode: 'index', 
          intersect: false,
          callbacks: {
            label: function(context) {
              let label = context.dataset.label || '';
              if (label) {
                label += ': ';
              }
              // Altijd hele getallen tonen voor klantenaantallen
              if (context.parsed.y !== null) {
                label += Math.round(context.parsed.y);
              }
              return label;
            }
          }
        },
        legend: { position: 'bottom' },
      },
      scales: { x: { stacked: true }, y: { beginAtZero: true } },
    },
  });
}


  /* ---------- TARGETS (dit jaar & volgend jaar) ---------- */
  // Map voor forecast-waarden, handig voor optellen
  const fcMap = new Map(
    fc.labels.map((k, i) => [k, { normal: fc.normal[i], event: fc.event[i] }]),
  );

  const currentYear = new Date().getFullYear();
  const years = [currentYear, currentYear + 1];
  if (showExtraYears) {
    years.push(currentYear + 2, currentYear + 3);
  }

  const totals = years.map(yr => {
    // alle maanden in labels die bij dit jaar horen
    const keys = combinedLabels.filter(k => k.startsWith(yr));
    return keys.reduce((sum, k) => {
      if (monthly.has(k)) {
        const { normal, event } = monthly.get(k);
        return sum + normal + event;
      }
      const fcVal = fcMap.get(k);
      return sum + (fcVal?.normal || 0) + (fcVal?.event || 0);
    }, 0);
  });

  // Bereken gerealiseerde omzet in geselecteerde periode
  let realizedRevenue = 0;
  let realizedPeriod = '';
  
  if (dateFilterFrom || dateFilterTo) {
    // Bereken gerealiseerde omzet binnen de gefilterde periode
    const fromDate = dateFilterFrom || '1900-01';
    const toDate = dateFilterTo || '2100-12';
    
    // Tel alle historische omzet op binnen de gefilterde periode
    histLabels.forEach(key => {
      if (key >= fromDate && key <= toDate) {
        const { normal, event } = monthly.get(key);
        realizedRevenue += normal + event;
      }
    });
    
    // Bepaal de periode tekst
    if (dateFilterFrom && dateFilterTo) {
      realizedPeriod = `van ${dateFilterFrom} tot ${dateFilterTo}`;
    } else if (dateFilterFrom) {
      realizedPeriod = `vanaf ${dateFilterFrom}`;
    } else if (dateFilterTo) {
      realizedPeriod = `tot ${dateFilterTo}`;
    }
  }

  yearTargetBox.innerHTML =
    years.map((yr, idx) => `Target ${yr}: <strong>${euro(totals[idx])}</strong>`).join(' &nbsp;|&nbsp; ');

  // Toon gerealiseerde omzet als datumfilter actief is
  if (dateFilterFrom || dateFilterTo) {
    yearTargetBox.innerHTML += 
      `<br><span class="text-sm text-blue-600">⚠️ Targets berekend op basis van gefilterde periode</span>`;
    
    if (realizedRevenue > 0) {
      yearTargetBox.innerHTML += 
        `<br><span class="text-sm text-green-600">✅ Gerealiseerde omzet ${realizedPeriod}: <strong>${euro(realizedRevenue)}</strong></span>`;
    }
  }

  // Trendstatistieken tonen: gemiddelde MoM groei en trend-target voor dit jaar
  try {
    const allHistTotals = histTotal || [];
    if (allHistTotals.length >= 2) {
      const avgHist = allHistTotals.reduce((s,v)=>s+v,0) / allHistTotals.length;
      const { slope } = chart?.$trendStats || computeLinearRegression(allHistTotals.map((_,i)=>i), allHistTotals);
      const avgMoM = avgHist ? (slope / avgHist) * 100 : 0;
      yearTargetBox.innerHTML += `<br><span class="text-sm">Trend MoM groei: <strong>${avgMoM.toFixed(2)}%</strong></span>`;

      // Eenvoudige trend-target: som van trendprojectie binnen dit jaar
      const thisYear = years[0];
      const thisYearKeys = [...histLabels, ...filteredFcLabels].filter(k => k.startsWith(thisYear));
      if (thisYearKeys.length) {
        const startIx = histLabels.findIndex(k => k.startsWith(thisYear));
        const startIndex = startIx >= 0 ? startIx : histLabels.length; // als jaar pas in forecast valt
        const { slope: s2, intercept: b2 } = chart?.$trendStats || computeLinearRegression(allHistTotals.map((_,i)=>i), allHistTotals);
        let trendSum = 0;
        for (let i = 0; i < thisYearKeys.length; i++) {
          const ix = startIndex + i;
          trendSum += b2 + s2 * ix;
        }
        yearTargetBox.innerHTML += `<br><span class="text-sm">Trend target ${thisYear}: <strong>${euro(trendSum)}</strong></span>`;
      }
    }
  } catch {}

  const normalizeFilterValue = (value, fallback = 'Alle') =>
    value && value !== '__all' ? value : fallback;

  const historicalData = histLabels.map((label, idx) => {
    const monthData = monthly.get(label) || { normal: 0, event: 0 };
    const normalCustomers = histCustCounts[idx] ?? 0;
    const avgRevenuePerNormal = normalCustomers > 0 ? monthData.normal / normalCustomers : 0;
    return {
      month: label,
      type: 'Historisch',
      normalRevenue: monthData.normal,
      eventRevenue: monthData.event,
      totalRevenue: monthData.normal + monthData.event,
      normalCustomers,
      avgRevenuePerNormal,
    };
  });

  const forecastData = (Array.isArray(fc.details) ? selectedFcIndices.map(i => fc.details[i]) : [])
    .filter(Boolean)
    .map(detail => ({
      month: detail.month,
      type: 'Forecast',
      normalRevenue: detail.normalRevenue ?? 0,
      eventRevenue: detail.eventRevenue ?? 0,
      totalRevenue: detail.totalRevenue ?? ((detail.normalRevenue ?? 0) + (detail.eventRevenue ?? 0)),
      normalCustomers: detail.normalCustomers ?? null,
      avgRevenuePerNormal: detail.avgRevenuePerNormal ?? 0,
    }));

  const eventCustomerExport = [...eventCustomers].map(name => {
    const cfg = eventSettings.get(name) || {};
    const revenueMap = eventByClient.get(name);
    let totalRevenue = 0;
    if (revenueMap instanceof Map) {
      revenueMap.forEach(val => { totalRevenue += Number(val) || 0; });
    }
    return {
      name,
      totalRevenue,
      growth: cfg.growth ?? 0,
      changeMonth: cfg.changeMonth || '',
      changePct: cfg.changePct ?? 0,
      stop: cfg.stop || '',
      includeInSeasonality: !!cfg.includeInSeasonality,
      excludeFromTarget: !!cfg.excludeFromTarget,
    };
  });

  lastExportPayload = {
    generatedAt: new Date().toISOString(),
    filters: {
      supplier: normalizeFilterValue(selectedSupplier),
      artikelgroep: normalizeFilterValue(selectedArtikelgroep),
      country: normalizeFilterValue(selectedCountry),
      customer: normalizeFilterValue(selectedCustomer),
      segment: normalizeFilterValue(selectedSegment, 'Alle segmenten'),
      forecastMode,
      customerMode,
    },
    dateRange: {
      from: dateFilterFrom || '',
      to: dateFilterTo || '',
    },
    eventCustomers: eventCustomerExport,
    months: [...historicalData, ...forecastData],
  };
  
  // Render klantanalyse
  renderCustomerAnalysis(filteredRows);
  
  // Render eerste aankoop analyse
  renderFirstPurchaseAnalysis(filteredRows);
}

/* -------------  KLANTANALYSE: DEEP DIVE ------------- */
let customerAnalysisData = [];
let customerAnalysisSortColumn = 'totalRevenue';
let customerAnalysisSortDirection = 'desc';
let deepDiveMonthlyChart = null;

function renderCustomerAnalysis(filteredRows) {
  if (!rawRows.length || !filteredRows || filteredRows.length === 0) {
    const tbody = document.getElementById('customerAnalysisTableBody');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="6" class="px-3 py-4 text-center text-gray-500">Geen data beschikbaar. Upload eerst een CSV.</td></tr>';
    }
    return;
  }

  // Verzamel alle unieke klanten die voldoen aan de filters
  const filteredCustomers = new Set(filteredRows.map(r => r['Besteld door']));
  
  // Voor elke klant: bereken statistieken
  customerAnalysisData = Array.from(filteredCustomers).map(customer => {
    // Omzet binnen gefilterde producten
    const filteredCustomerRows = filteredRows.filter(r => r['Besteld door'] === customer);
    const filteredRevenue = filteredCustomerRows.reduce((sum, r) => sum + (Number(r.Factuurbedrag) || 0), 0);
    
    // Alle transacties van deze klant (ongeacht filters)
    const allCustomerRows = rawRows.filter(r => r['Besteld door'] === customer);
    const totalRevenue = allCustomerRows.reduce((sum, r) => sum + (Number(r.Factuurbedrag) || 0), 0);
    
    // Groepeer per maand voor gemiddelde berekening
    const monthlyRevenue = new Map();
    allCustomerRows.forEach(r => {
      const monthKey = `${r.Jaar}-${String(r.Maand).padStart(2, '0')}`;
      monthlyRevenue.set(monthKey, (monthlyRevenue.get(monthKey) || 0) + (Number(r.Factuurbedrag) || 0));
    });
    const avgMonthlyRevenue = monthlyRevenue.size > 0 
      ? Array.from(monthlyRevenue.values()).reduce((sum, val) => sum + val, 0) / monthlyRevenue.size 
      : 0;
    
    // Analyseer leveranciers
    const suppliersMap = new Map();
    allCustomerRows.forEach(r => {
      const supplier = r.Leverancier || 'Onbekend';
      if (!suppliersMap.has(supplier)) {
        suppliersMap.set(supplier, { supplier, revenue: 0, orders: 0 });
      }
      const s = suppliersMap.get(supplier);
      s.revenue += Number(r.Factuurbedrag) || 0;
      s.orders += 1;
    });
    
    const suppliers = Array.from(suppliersMap.values())
      .sort((a, b) => b.revenue - a.revenue);
    
    // Laatste 3 maanden omzet
    const sortedMonths = Array.from(monthlyRevenue.entries())
      .map(([month, revenue]) => ({ month, revenue }))
      .sort((a, b) => b.month.localeCompare(a.month))
      .slice(0, 3);
    
    // Andere producten (producten die NIET in gefilterde set zitten)
    const filteredArticles = new Set(filteredRows.map(r => r.Artikel));
    const otherProductRows = allCustomerRows.filter(r => !filteredArticles.has(r.Artikel));
    const otherProducts = new Set(otherProductRows.map(r => r.Artikel));
    const otherProductsRevenue = otherProductRows.reduce((sum, r) => sum + (Number(r.Factuurbedrag) || 0), 0);
    
    return {
      customer,
      filteredRevenue,
      totalRevenue,
      avgMonthlyRevenue,
      otherProductsCount: otherProducts.size,
      otherProductsRevenue,
      otherProducts: Array.from(otherProducts),
      suppliers,
      suppliersCount: suppliers.length,
      last3Months: sortedMonths,
      allRows: allCustomerRows,
      monthlyRevenue: Array.from(monthlyRevenue.entries()).map(([month, revenue]) => ({ month, revenue })).sort((a, b) => a.month.localeCompare(b.month))
    };
  });

  // Sorteer data
  sortCustomerAnalysisData();
  
  // Render tabel
  renderCustomerAnalysisTable();
  
  // Update samenvatting
  const summaryEl = document.getElementById('customerAnalysisSummary');
  if (summaryEl) {
    const totalCustomers = customerAnalysisData.length;
    const totalFilteredRevenue = customerAnalysisData.reduce((sum, c) => sum + c.filteredRevenue, 0);
    const totalOtherRevenue = customerAnalysisData.reduce((sum, c) => sum + c.otherProductsRevenue, 0);
    const totalRevenue = customerAnalysisData.reduce((sum, c) => sum + c.totalRevenue, 0);
    const uniqueSuppliers = new Set();
    customerAnalysisData.forEach(c => {
      c.suppliers.forEach(s => uniqueSuppliers.add(s.supplier));
    });
    
    summaryEl.innerHTML = `
      <div class="grid md:grid-cols-5 gap-4">
        <div class="p-2 bg-blue-50 rounded">
          <div class="text-xs text-gray-600">Aantal klanten</div>
          <div class="text-lg font-semibold">${totalCustomers}</div>
        </div>
        <div class="p-2 bg-green-50 rounded">
          <div class="text-xs text-gray-600">Totale omzet gefilterd</div>
          <div class="text-lg font-semibold">${euro(totalFilteredRevenue)}</div>
        </div>
        <div class="p-2 bg-purple-50 rounded">
          <div class="text-xs text-gray-600">Totale omzet alle klanten</div>
          <div class="text-lg font-semibold">${euro(totalRevenue)}</div>
        </div>
        <div class="p-2 bg-orange-50 rounded">
          <div class="text-xs text-gray-600">Gem. omzet/klant/maand</div>
          <div class="text-lg font-semibold">${euro(customerAnalysisData.length > 0 ? customerAnalysisData.reduce((sum, c) => sum + c.avgMonthlyRevenue, 0) / customerAnalysisData.length : 0)}</div>
        </div>
        <div class="p-2 bg-pink-50 rounded">
          <div class="text-xs text-gray-600">Unieke leveranciers</div>
          <div class="text-lg font-semibold">${uniqueSuppliers.size}</div>
        </div>
      </div>
    `;
  }
}

function sortCustomerAnalysisData() {
  customerAnalysisData.sort((a, b) => {
    let aVal, bVal;
    switch (customerAnalysisSortColumn) {
      case 'customer':
        aVal = a.customer.toLowerCase();
        bVal = b.customer.toLowerCase();
        break;
      case 'filteredRevenue':
        aVal = a.filteredRevenue;
        bVal = b.filteredRevenue;
        break;
      case 'totalRevenue':
        aVal = a.totalRevenue;
        bVal = b.totalRevenue;
        break;
      case 'avgMonthlyRevenue':
        aVal = a.avgMonthlyRevenue;
        bVal = b.avgMonthlyRevenue;
        break;
      case 'otherProducts':
        aVal = a.otherProductsCount;
        bVal = b.otherProductsCount;
        break;
      case 'suppliers':
        aVal = a.suppliersCount;
        bVal = b.suppliersCount;
        break;
      default:
        aVal = a.totalRevenue;
        bVal = b.totalRevenue;
    }
    
    if (typeof aVal === 'string') {
      return customerAnalysisSortDirection === 'asc' 
        ? aVal.localeCompare(bVal)
        : bVal.localeCompare(aVal);
    } else {
      return customerAnalysisSortDirection === 'asc' 
        ? aVal - bVal
        : bVal - aVal;
    }
  });
}

function renderCustomerAnalysisTable() {
  const tbody = document.getElementById('customerAnalysisTableBody');
  if (!tbody) return;
  
  const searchTerm = document.getElementById('customerAnalysisSearch')?.value.toLowerCase() || '';
  const filteredData = customerAnalysisData.filter(c => 
    c.customer.toLowerCase().includes(searchTerm)
  );
  
  if (filteredData.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="px-3 py-4 text-center text-gray-500">Geen klanten gevonden.</td></tr>';
    return;
  }
  
  tbody.innerHTML = filteredData.map(c => {
    // Format leveranciers info
    const topSuppliers = c.suppliers.slice(0, 3);
    const suppliersHtml = c.suppliers.length > 0 
      ? `<div class="text-xs">
           ${topSuppliers.map(s => `<div class="mb-1">
             <span class="font-medium">${escapeHtml(s.supplier)}</span>
             <span class="text-gray-600">: ${euro(s.revenue)}</span>
             ${s.orders > 1 ? `<span class="text-gray-500">(${s.orders}x)</span>` : ''}
           </div>`).join('')}
           ${c.suppliers.length > 3 ? `<div class="text-gray-500 text-xs mt-1">+${c.suppliers.length - 3} meer</div>` : ''}
         </div>`
      : '<span class="text-gray-400">-</span>';
    
    // Format laatste 3 maanden
    const lastMonthsHtml = c.last3Months.length > 0
      ? `<div class="text-xs">
           ${c.last3Months.map(m => `<div>${m.month}: ${euro(m.revenue)}</div>`).join('')}
         </div>`
      : '<span class="text-gray-400">-</span>';
    
    return `
    <tr class="border-b hover:bg-gray-50">
      <td class="px-3 py-2">
        <div class="font-medium">${escapeHtml(c.customer)}</div>
        <div class="text-xs text-gray-500 mt-1">Laatste 3 maanden:</div>
        ${lastMonthsHtml}
      </td>
      <td class="px-3 py-2 text-right">
        <div class="font-semibold">${euro(c.filteredRevenue)}</div>
      </td>
      <td class="px-3 py-2 text-right">
        <div class="font-semibold">${euro(c.totalRevenue)}</div>
      </td>
      <td class="px-3 py-2 text-right">
        <div class="font-semibold">${euro(c.avgMonthlyRevenue)}</div>
      </td>
      <td class="px-3 py-2">
        <div class="text-xs text-gray-600 mb-1">${c.suppliersCount} leverancier${c.suppliersCount !== 1 ? 's' : ''}</div>
        ${suppliersHtml}
      </td>
      <td class="px-3 py-2 text-right">
        <div class="text-xs">${c.otherProductsCount} producten</div>
        <div class="text-xs text-gray-500">${euro(c.otherProductsRevenue)}</div>
      </td>
      <td class="px-3 py-2 text-center">
        <button class="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 text-xs" 
                onclick="showCustomerDeepDive('${escapeHtml(c.customer).replace(/'/g, "\\'")}')">
          Deep Dive
        </button>
      </td>
    </tr>
  `;
  }).join('');
  
  // Update sort indicators
  document.querySelectorAll('[data-sort]').forEach(th => {
    const indicator = th.querySelector('.sort-indicator');
    if (indicator) {
      if (th.dataset.sort === customerAnalysisSortColumn) {
        indicator.textContent = customerAnalysisSortDirection === 'asc' ? ' ↑' : ' ↓';
      } else {
        indicator.textContent = ' ↕';
      }
    }
  });
}

function showCustomerDeepDive(customerName) {
  const customer = customerAnalysisData.find(c => c.customer === customerName);
  if (!customer) return;
  
  const modal = document.getElementById('customerDeepDiveModal');
  const customerNameEl = document.getElementById('deepDiveCustomerName');
  const summaryEl = document.getElementById('deepDiveSummary');
  const productsTableBody = document.getElementById('deepDiveProductsTable');
  const transactionsTableBody = document.getElementById('deepDiveTransactionsTable');
  const suppliersTableBody = document.getElementById('deepDiveSuppliersTable');
  const monthlyTableBody = document.getElementById('deepDiveMonthlyTable');
  const productsBySupplierEl = document.getElementById('deepDiveProductsBySupplier');
  
  if (!modal || !customerNameEl || !summaryEl) return;
  
  // Update naam
  customerNameEl.textContent = customerName;
  
  // Analyseer leveranciers
  const suppliersMap = new Map();
  customer.allRows.forEach(r => {
    const supplier = r.Leverancier || 'Onbekend';
    if (!suppliersMap.has(supplier)) {
      suppliersMap.set(supplier, { supplier, orders: 0, revenue: 0, products: new Set(), months: new Set() });
    }
    const s = suppliersMap.get(supplier);
    s.orders += 1;
    s.revenue += Number(r.Factuurbedrag) || 0;
    s.products.add(r.Artikel);
    const monthKey = `${r.Jaar}-${String(r.Maand).padStart(2, '0')}`;
    s.months.add(monthKey);
  });
  
  const suppliers = Array.from(suppliersMap.values())
    .map(s => ({
      ...s,
      products: Array.from(s.products),
      months: Array.from(s.months).sort()
    }))
    .sort((a, b) => b.revenue - a.revenue);
  
  // Update samenvatting
  const monthsActive = customer.monthlyRevenue.length;
  const firstMonth = customer.monthlyRevenue.length > 0 ? customer.monthlyRevenue[0].month : '-';
  const lastMonth = customer.monthlyRevenue.length > 0 ? customer.monthlyRevenue[customer.monthlyRevenue.length - 1].month : '-';
  const uniqueSuppliers = suppliers.length;
  
  summaryEl.innerHTML = `
    <div class="p-3 bg-blue-50 rounded">
      <div class="text-xs text-gray-600">Totale omzet</div>
      <div class="text-xl font-semibold">${euro(customer.totalRevenue)}</div>
    </div>
    <div class="p-3 bg-green-50 rounded">
      <div class="text-xs text-gray-600">Omzet gefilterd</div>
      <div class="text-xl font-semibold">${euro(customer.filteredRevenue)}</div>
    </div>
    <div class="p-3 bg-purple-50 rounded">
      <div class="text-xs text-gray-600">Actieve maanden</div>
      <div class="text-xl font-semibold">${monthsActive}</div>
      <div class="text-xs text-gray-500">${firstMonth} - ${lastMonth}</div>
    </div>
    <div class="p-3 bg-orange-50 rounded">
      <div class="text-xs text-gray-600">Aantal leveranciers</div>
      <div class="text-xl font-semibold">${uniqueSuppliers}</div>
    </div>
  `;
  
  // Render leveranciers tabel
  if (suppliersTableBody) {
    suppliersTableBody.innerHTML = suppliers.map(s => {
      const percentage = customer.totalRevenue > 0 ? (s.revenue / customer.totalRevenue * 100) : 0;
      return `
        <tr class="border-b hover:bg-gray-50">
          <td class="px-3 py-2 font-medium">${escapeHtml(s.supplier)}</td>
          <td class="px-3 py-2 text-right">${s.orders}</td>
          <td class="px-3 py-2 text-right font-semibold">${euro(s.revenue)}</td>
          <td class="px-3 py-2 text-right">${euro(s.orders > 0 ? s.revenue / s.orders : 0)}</td>
          <td class="px-3 py-2 text-right">${percentage.toFixed(1)}%</td>
        </tr>
      `;
    }).join('');
  }
  
  // Maand-op-maand detail analyse
  const monthlyDetailMap = new Map();
  customer.allRows.forEach(r => {
    const monthKey = `${r.Jaar}-${String(r.Maand).padStart(2, '0')}`;
    if (!monthlyDetailMap.has(monthKey)) {
      monthlyDetailMap.set(monthKey, {
        month: monthKey,
        revenue: 0,
        orders: 0,
        suppliers: new Set()
      });
    }
    const m = monthlyDetailMap.get(monthKey);
    m.revenue += Number(r.Factuurbedrag) || 0;
    m.orders += 1;
    m.suppliers.add(r.Leverancier || 'Onbekend');
  });
  
  const monthlyDetails = Array.from(monthlyDetailMap.values())
    .map(m => ({
      ...m,
      suppliers: Array.from(m.suppliers),
      avgOrderValue: m.orders > 0 ? m.revenue / m.orders : 0
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
  
  if (monthlyTableBody) {
    monthlyTableBody.innerHTML = monthlyDetails.map(m => `
      <tr class="border-b hover:bg-gray-50">
        <td class="px-3 py-2 font-medium">${m.month}</td>
        <td class="px-3 py-2 text-right font-semibold">${euro(m.revenue)}</td>
        <td class="px-3 py-2 text-right">${m.orders}</td>
        <td class="px-3 py-2 text-right">${euro(m.avgOrderValue)}</td>
        <td class="px-3 py-2 text-right">${m.suppliers.length}</td>
      </tr>
    `).join('');
  }
  
  // Producten per leverancier
  if (productsBySupplierEl) {
    productsBySupplierEl.innerHTML = suppliers.map(supplier => {
      // Verzamel producten voor deze leverancier
      const supplierProductsMap = new Map();
      customer.allRows
        .filter(r => (r.Leverancier || 'Onbekend') === supplier.supplier)
        .forEach(r => {
          const article = r.Artikel;
          if (!supplierProductsMap.has(article)) {
            supplierProductsMap.set(article, { article, orders: 0, revenue: 0 });
          }
          const p = supplierProductsMap.get(article);
          p.orders += 1;
          p.revenue += Number(r.Factuurbedrag) || 0;
        });
      
      const supplierProducts = Array.from(supplierProductsMap.values())
        .sort((a, b) => b.revenue - a.revenue);
      
      return `
        <div class="border rounded-lg p-4 bg-gray-50">
          <h4 class="font-semibold mb-2 text-lg">${escapeHtml(supplier.supplier)}</h4>
          <div class="text-xs text-gray-600 mb-3">
            ${supplier.orders} orders • ${euro(supplier.revenue)} totaal • ${supplier.products.length} unieke producten
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="bg-white border-b">
                  <th class="px-2 py-1 text-left">Product</th>
                  <th class="px-2 py-1 text-right">Orders</th>
                  <th class="px-2 py-1 text-right">Omzet</th>
                  <th class="px-2 py-1 text-right">Gem./order</th>
                </tr>
              </thead>
              <tbody>
                ${supplierProducts.map(p => `
                  <tr class="border-b">
                    <td class="px-2 py-1">${escapeHtml(p.article)}</td>
                    <td class="px-2 py-1 text-right">${p.orders}</td>
                    <td class="px-2 py-1 text-right">${euro(p.revenue)}</td>
                    <td class="px-2 py-1 text-right">${euro(p.orders > 0 ? p.revenue / p.orders : 0)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }).join('');
  }
  
  // Groepeer producten (met leverancier)
  const productsMap = new Map();
  customer.allRows.forEach(r => {
    const key = `${r.Artikel}|${r.Leverancier || 'Onbekend'}`;
    if (!productsMap.has(key)) {
      productsMap.set(key, { article: r.Artikel, supplier: r.Leverancier || 'Onbekend', orders: 0, revenue: 0 });
    }
    const p = productsMap.get(key);
    p.orders += 1;
    p.revenue += Number(r.Factuurbedrag) || 0;
  });
  
  const products = Array.from(productsMap.values())
    .sort((a, b) => b.revenue - a.revenue);
  
  if (productsTableBody) {
    productsTableBody.innerHTML = products.map(p => `
      <tr class="border-b hover:bg-gray-50">
        <td class="px-3 py-2">${escapeHtml(p.article)}</td>
        <td class="px-3 py-2">${escapeHtml(p.supplier)}</td>
        <td class="px-3 py-2 text-right">${p.orders}</td>
        <td class="px-3 py-2 text-right">${euro(p.revenue)}</td>
        <td class="px-3 py-2 text-right">${euro(p.orders > 0 ? p.revenue / p.orders : 0)}</td>
      </tr>
    `).join('');
  }
  
  // Toon transacties (gesorteerd op datum, nieuwste eerst)
  const sortedTransactions = customer.allRows
    .sort((a, b) => {
      const dateA = `${a.Jaar}-${String(a.Maand).padStart(2, '0')}`;
      const dateB = `${b.Jaar}-${String(b.Maand).padStart(2, '0')}`;
      if (dateB !== dateA) return dateB.localeCompare(dateA);
      // Als zelfde maand, sorteer op leverancier en dan product
      const supplierA = (a.Leverancier || '').toLowerCase();
      const supplierB = (b.Leverancier || '').toLowerCase();
      if (supplierA !== supplierB) return supplierA.localeCompare(supplierB);
      return (a.Artikel || '').toLowerCase().localeCompare((b.Artikel || '').toLowerCase());
    })
    .slice(0, 200); // Limiteer tot 200 meest recente
  
  if (transactionsTableBody) {
    transactionsTableBody.innerHTML = sortedTransactions.map(r => `
      <tr class="border-b hover:bg-gray-50">
        <td class="px-3 py-2">${r.Jaar}-${String(r.Maand).padStart(2, '0')}</td>
        <td class="px-3 py-2">${escapeHtml(r.Leverancier || '-')}</td>
        <td class="px-3 py-2">${escapeHtml(r.Artikel)}</td>
        <td class="px-3 py-2 text-right">${euro(Number(r.Factuurbedrag) || 0)}</td>
      </tr>
    `).join('');
    
    if (customer.allRows.length > 200) {
      transactionsTableBody.innerHTML += `
        <tr>
          <td colspan="4" class="px-3 py-2 text-center text-gray-500 text-xs">
            Toont eerste 200 van ${customer.allRows.length} transacties
          </td>
        </tr>
      `;
    }
  }
  
  // Render maandgrafiek met leveranciers breakdown
  renderDeepDiveMonthlyChart(customer.monthlyRevenue, customer.allRows);
  
  // Toon modal
  modal.classList.remove('hidden');
}

function renderDeepDiveMonthlyChart(monthlyData, customerRows = null) {
  const canvas = document.getElementById('deepDiveMonthlyChart');
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d');
  
  if (deepDiveMonthlyChart) {
    deepDiveMonthlyChart.destroy();
  }
  
  const labels = monthlyData.map(d => d.month);
  
  // Als we customerRows hebben, maak een gestapelde grafiek per leverancier
  if (customerRows && customerRows.length > 0) {
    // Verzamel unieke leveranciers
    const suppliers = [...new Set(customerRows.map(r => r.Leverancier || 'Onbekend'))];
    
    // Maak dataset per leverancier
    const datasets = suppliers.map((supplier, idx) => {
      const colors = [
        { bg: 'rgba(59, 130, 246, 0.6)', border: 'rgba(59, 130, 246, 1)' },
        { bg: 'rgba(16, 185, 129, 0.6)', border: 'rgba(16, 185, 129, 1)' },
        { bg: 'rgba(245, 158, 11, 0.6)', border: 'rgba(245, 158, 11, 1)' },
        { bg: 'rgba(239, 68, 68, 0.6)', border: 'rgba(239, 68, 68, 1)' },
        { bg: 'rgba(139, 92, 246, 0.6)', border: 'rgba(139, 92, 246, 1)' },
        { bg: 'rgba(236, 72, 153, 0.6)', border: 'rgba(236, 72, 153, 1)' },
      ];
      const color = colors[idx % colors.length];
      
      const data = labels.map(month => {
        return customerRows
          .filter(r => {
            const rowMonth = `${r.Jaar}-${String(r.Maand).padStart(2, '0')}`;
            return rowMonth === month && (r.Leverancier || 'Onbekend') === supplier;
          })
          .reduce((sum, r) => sum + (Number(r.Factuurbedrag) || 0), 0);
      });
      
      return {
        label: supplier,
        data: data,
        backgroundColor: color.bg,
        borderColor: color.border,
        borderWidth: 1
      };
    });
    
    deepDiveMonthlyChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { 
            display: suppliers.length <= 6,
            position: 'bottom'
          },
          tooltip: {
            mode: 'index',
            intersect: false,
            callbacks: {
              label: function(context) {
                return `${context.dataset.label}: ${euro(context.parsed.y)}`;
              },
              footer: function(tooltipItems) {
                const total = tooltipItems.reduce((sum, item) => sum + item.parsed.y, 0);
                return `Totaal: ${euro(total)}`;
              }
            }
          }
        },
        scales: {
          x: { stacked: true },
          y: { 
            stacked: true,
            beginAtZero: true,
            ticks: {
              callback: function(value) {
                return euro(value);
              }
            }
          }
        }
      }
    });
  } else {
    // Eenvoudige grafiek zonder leveranciers
    const revenues = monthlyData.map(d => d.revenue);
    
    deepDiveMonthlyChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'Omzet per maand',
          data: revenues,
          backgroundColor: 'rgba(59, 130, 246, 0.5)',
          borderColor: 'rgba(59, 130, 246, 1)',
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function(context) {
                return euro(context.parsed.y);
              }
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback: function(value) {
                return euro(value);
              }
            }
          }
        }
      }
    });
  }
}

// Event listeners voor klantanalyse
function setupCustomerAnalysisListeners() {
  const searchInput = document.getElementById('customerAnalysisSearch');
  
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      renderCustomerAnalysisTable();
    });
  }
  
  // Sort handlers - gebruik event delegation omdat tabel dynamisch wordt gerenderd
  const table = document.getElementById('customerAnalysisTable');
  if (table) {
    table.addEventListener('click', (e) => {
      const th = e.target.closest('[data-sort]');
      if (th) {
        const column = th.dataset.sort;
        if (customerAnalysisSortColumn === column) {
          customerAnalysisSortDirection = customerAnalysisSortDirection === 'asc' ? 'desc' : 'asc';
        } else {
          customerAnalysisSortColumn = column;
          customerAnalysisSortDirection = 'desc';
        }
        sortCustomerAnalysisData();
        renderCustomerAnalysisTable();
      }
    });
  }
  
  // Modal close handlers
  const closeBtn = document.getElementById('closeDeepDiveModal');
  const modal = document.getElementById('customerDeepDiveModal');
  
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      if (modal) modal.classList.add('hidden');
    });
  }
  
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.add('hidden');
      }
    });
  }
}

// Setup listeners wanneer DOM klaar is
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupCustomerAnalysisListeners);
} else {
  setupCustomerAnalysisListeners();
}

// Maak functie globaal beschikbaar voor onclick handlers
window.showCustomerDeepDive = showCustomerDeepDive;

/* -------------  EERSTE AANKOOP ANALYSE ------------- */
let firstPurchaseData = [];
let firstPurchaseSortColumn = 'firstPurchaseDate';
let firstPurchaseSortDirection = 'asc';

function renderFirstPurchaseAnalysis(filteredRows) {
  if (!rawRows.length) {
    const tbody = document.getElementById('firstPurchaseTableBody');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="6" class="px-3 py-4 text-center text-gray-500">Geen data beschikbaar. Upload eerst een CSV.</td></tr>';
    }
    return;
  }

  // Verzamel alle unieke klanten
  const allCustomers = new Set(rawRows.map(r => r['Besteld door']));
  
  // Voor elke klant: bepaal eerste aankoop en follow-up aankopen
  firstPurchaseDataOriginal = Array.from(allCustomers).map(customer => {
    const customerRows = rawRows
      .filter(r => r['Besteld door'] === customer)
      .map(r => ({
        ...r,
        dateKey: `${r.Jaar}-${String(r.Maand).padStart(2, '0')}`,
        dateValue: new Date(r.Jaar, r.Maand - 1, 1)
      }))
      .sort((a, b) => a.dateValue - b.dateValue); // Sorteer op datum
    
    if (customerRows.length === 0) return null;
    
    const firstRow = customerRows[0];
    const firstPurchase = {
      date: firstRow.dateKey,
      dateValue: firstRow.dateValue,
      supplier: firstRow.Leverancier || 'Onbekend',
      article: firstRow.Artikel,
      revenue: Number(firstRow.Factuurbedrag) || 0
    };
    
    // Bepaal andere aankopen (na eerste aankoop)
    const otherPurchases = customerRows.slice(1);
    const otherSuppliers = new Set();
    const otherArticles = new Set();
    let otherRevenue = 0;
    let timeToNextPurchase = null;
    
    otherPurchases.forEach((row, idx) => {
      if (row.Leverancier && row.Leverancier !== firstPurchase.supplier) {
        otherSuppliers.add(row.Leverancier);
      }
      if (row.Artikel && row.Artikel !== firstPurchase.article) {
        otherArticles.add(row.Artikel);
      }
      otherRevenue += Number(row.Factuurbedrag) || 0;
      
      // Eerste andere aankoop (niet dezelfde als eerste)
      if (idx === 0 && (row.Leverancier !== firstPurchase.supplier || row.Artikel !== firstPurchase.article)) {
        const daysDiff = Math.round((row.dateValue - firstRow.dateValue) / (1000 * 60 * 60 * 24));
        timeToNextPurchase = daysDiff;
      }
    });
    
    // Als eerste andere aankoop nog niet gevonden, zoek verder
    if (timeToNextPurchase === null && otherPurchases.length > 0) {
      for (let i = 0; i < otherPurchases.length; i++) {
        const row = otherPurchases[i];
        if (row.Leverancier !== firstPurchase.supplier || row.Artikel !== firstPurchase.article) {
          const daysDiff = Math.round((row.dateValue - firstRow.dateValue) / (1000 * 60 * 60 * 24));
          timeToNextPurchase = daysDiff;
          break;
        }
      }
    }
    
    // Bepaal of klant ook andere merken heeft gekocht
    const boughtOtherSuppliers = otherSuppliers.size > 0;
    const boughtOtherProducts = otherArticles.size > 0;
    
    // Totale omzet
    const totalRevenue = customerRows.reduce((sum, r) => sum + (Number(r.Factuurbedrag) || 0), 0);
    
    return {
      customer,
      firstPurchase,
      otherPurchases: otherPurchases.length,
      otherSuppliers: Array.from(otherSuppliers),
      otherSuppliersCount: otherSuppliers.size,
      otherArticles: Array.from(otherArticles),
      otherArticlesCount: otherArticles.size,
      otherRevenue,
      timeToNextPurchase,
      boughtOtherSuppliers,
      boughtOtherProducts,
      totalRevenue,
      allRows: customerRows
    };
  }).filter(c => c !== null);
  
  // Update supplier filter dropdown
  updateFirstPurchaseSupplierFilter();
  
  // Filter en sorteer
  filterAndSortFirstPurchaseData();
  
  // Render tabel
  renderFirstPurchaseTable();
  
  // Update samenvatting
  updateFirstPurchaseSummary();
}

function updateFirstPurchaseSupplierFilter() {
  const filterSelect = document.getElementById('firstPurchaseSupplierFilter');
  if (!filterSelect) return;
  
  const sourceData = firstPurchaseDataOriginal.length > 0 ? firstPurchaseDataOriginal : firstPurchaseData;
  const suppliers = [...new Set(sourceData.map(c => c.firstPurchase.supplier))].sort();
  
  // Behoud huidige selectie
  const currentValue = filterSelect.value;
  
  filterSelect.innerHTML = '<option value="__all">Alle merken</option>' +
    suppliers.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  
  if (currentValue && suppliers.includes(currentValue)) {
    filterSelect.value = currentValue;
  }
}

// Bewaar originele data apart
let firstPurchaseDataOriginal = [];

function filterAndSortFirstPurchaseData() {
  const supplierFilter = document.getElementById('firstPurchaseSupplierFilter')?.value || '__all';
  const searchTerm = document.getElementById('firstPurchaseSearch')?.value.toLowerCase() || '';
  
  // Gebruik originele data als basis
  const sourceData = firstPurchaseDataOriginal.length > 0 ? firstPurchaseDataOriginal : firstPurchaseData;
  let filtered = [...sourceData]; // Maak kopie van originele data
  
  // Filter op leverancier
  if (supplierFilter !== '__all') {
    filtered = filtered.filter(c => c.firstPurchase.supplier === supplierFilter);
  }
  
  // Filter op zoekterm
  if (searchTerm) {
    filtered = filtered.filter(c => 
      c.customer.toLowerCase().includes(searchTerm) ||
      c.firstPurchase.supplier.toLowerCase().includes(searchTerm) ||
      c.firstPurchase.article.toLowerCase().includes(searchTerm)
    );
  }
  
  // Sorteer
  filtered.sort((a, b) => {
    let aVal, bVal;
    switch (firstPurchaseSortColumn) {
      case 'customer':
        aVal = a.customer.toLowerCase();
        bVal = b.customer.toLowerCase();
        break;
      case 'firstPurchase':
        aVal = a.firstPurchase.dateValue;
        bVal = b.firstPurchase.dateValue;
        break;
      case 'otherPurchases':
        aVal = a.otherPurchases;
        bVal = b.otherPurchases;
        break;
      case 'timeToNext':
        aVal = a.timeToNextPurchase !== null ? a.timeToNextPurchase : Infinity;
        bVal = b.timeToNextPurchase !== null ? b.timeToNextPurchase : Infinity;
        break;
      case 'totalRevenue':
        aVal = a.totalRevenue;
        bVal = b.totalRevenue;
        break;
      default:
        aVal = a.firstPurchase.dateValue;
        bVal = b.firstPurchase.dateValue;
    }
    
    if (typeof aVal === 'string') {
      return firstPurchaseSortDirection === 'asc' 
        ? aVal.localeCompare(bVal)
        : bVal.localeCompare(aVal);
    } else {
      return firstPurchaseSortDirection === 'asc' 
        ? aVal - bVal
        : bVal - aVal;
    }
  });
  
  // Update globale filtered data voor rendering
  firstPurchaseData = filtered;
}

function renderFirstPurchaseTable() {
  const tbody = document.getElementById('firstPurchaseTableBody');
  if (!tbody) return;
  
  const dataToRender = firstPurchaseData;
  
  if (dataToRender.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="px-3 py-4 text-center text-gray-500">Geen klanten gevonden.</td></tr>';
    return;
  }
  
  tbody.innerHTML = dataToRender.map(c => {
    const timeToNextText = c.timeToNextPurchase !== null 
      ? `${c.timeToNextPurchase} dagen`
      : c.otherPurchases > 0 
        ? 'Alleen zelfde product/merk'
        : 'Geen andere aankopen';
    
    const otherSuppliersText = c.otherSuppliersCount > 0
      ? `<div class="text-xs">
           <div class="font-medium text-green-600">✓ ${c.otherSuppliersCount} andere merk${c.otherSuppliersCount !== 1 ? 'en' : ''}</div>
           <div class="text-gray-600 mt-1">${c.otherSuppliers.slice(0, 3).map(s => escapeHtml(s)).join(', ')}${c.otherSuppliers.length > 3 ? '...' : ''}</div>
         </div>`
      : '<span class="text-gray-400 text-xs">Geen andere merken</span>';
    
    const otherProductsText = c.otherArticlesCount > 0
      ? `<div class="text-xs text-gray-600">${c.otherArticlesCount} andere product${c.otherArticlesCount !== 1 ? 'en' : ''}</div>`
      : '<span class="text-gray-400 text-xs">Geen andere producten</span>';
    
    return `
    <tr class="border-b hover:bg-gray-50">
      <td class="px-3 py-2">
        <div class="font-medium">${escapeHtml(c.customer)}</div>
      </td>
      <td class="px-3 py-2">
        <div class="text-xs">
          <div class="font-semibold">${escapeHtml(c.firstPurchase.supplier)}</div>
          <div class="text-gray-600">${escapeHtml(c.firstPurchase.article)}</div>
          <div class="text-gray-500 mt-1">${c.firstPurchase.date}</div>
          <div class="text-gray-500">${euro(c.firstPurchase.revenue)}</div>
        </div>
      </td>
      <td class="px-3 py-2">
        <div class="mb-2">${otherSuppliersText}</div>
        <div class="mt-2">${otherProductsText}</div>
        ${c.otherPurchases > 0 ? `<div class="text-xs text-gray-500 mt-1">${c.otherPurchases} andere aankopen</div>` : ''}
      </td>
      <td class="px-3 py-2 text-right">
        <div class="text-sm">${timeToNextText}</div>
        ${c.otherRevenue > 0 ? `<div class="text-xs text-gray-500">${euro(c.otherRevenue)}</div>` : ''}
      </td>
      <td class="px-3 py-2 text-right">
        <div class="font-semibold">${euro(c.totalRevenue)}</div>
      </td>
      <td class="px-3 py-2 text-center">
        <button class="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 text-xs" 
                onclick="showCustomerDeepDive('${escapeHtml(c.customer).replace(/'/g, "\\'")}')">
          Deep Dive
        </button>
      </td>
    </tr>
  `;
  }).join('');
  
  // Update sort indicators
  document.querySelectorAll('#firstPurchaseTable [data-sort]').forEach(th => {
    const indicator = th.querySelector('.sort-indicator');
    if (indicator) {
      if (th.dataset.sort === firstPurchaseSortColumn) {
        indicator.textContent = firstPurchaseSortDirection === 'asc' ? ' ↑' : ' ↓';
      } else {
        indicator.textContent = ' ↕';
      }
    }
  });
}

function updateFirstPurchaseSummary() {
  const summaryEl = document.getElementById('firstPurchaseSummary');
  if (!summaryEl) return;
  
  const dataToAnalyze = firstPurchaseData;
  const totalCustomers = dataToAnalyze.length;
  const customersWithOtherSuppliers = dataToAnalyze.filter(c => c.boughtOtherSuppliers).length;
  const customersWithOtherProducts = dataToAnalyze.filter(c => c.boughtOtherProducts).length;
  const avgTimeToNext = dataToAnalyze
    .filter(c => c.timeToNextPurchase !== null)
    .reduce((sum, c) => sum + c.timeToNextPurchase, 0);
  const avgTimeToNextCount = dataToAnalyze.filter(c => c.timeToNextPurchase !== null).length;
  
  summaryEl.innerHTML = `
    <div class="grid md:grid-cols-4 gap-4">
      <div class="p-2 bg-blue-50 rounded">
        <div class="text-xs text-gray-600">Totaal klanten</div>
        <div class="text-lg font-semibold">${totalCustomers}</div>
      </div>
      <div class="p-2 bg-green-50 rounded">
        <div class="text-xs text-gray-600">Kochten andere merken</div>
        <div class="text-lg font-semibold">${customersWithOtherSuppliers} (${totalCustomers > 0 ? Math.round(customersWithOtherSuppliers / totalCustomers * 100) : 0}%)</div>
      </div>
      <div class="p-2 bg-purple-50 rounded">
        <div class="text-xs text-gray-600">Kochten andere producten</div>
        <div class="text-lg font-semibold">${customersWithOtherProducts} (${totalCustomers > 0 ? Math.round(customersWithOtherProducts / totalCustomers * 100) : 0}%)</div>
      </div>
      <div class="p-2 bg-orange-50 rounded">
        <div class="text-xs text-gray-600">Gem. tijd tot volgende</div>
        <div class="text-lg font-semibold">${avgTimeToNextCount > 0 ? Math.round(avgTimeToNext / avgTimeToNextCount) : 0} dagen</div>
      </div>
    </div>
  `;
}

// Event listeners voor eerste aankoop analyse
function setupFirstPurchaseListeners() {
  const supplierFilter = document.getElementById('firstPurchaseSupplierFilter');
  const searchInput = document.getElementById('firstPurchaseSearch');
  
  if (supplierFilter) {
    supplierFilter.addEventListener('change', () => {
      filterAndSortFirstPurchaseData();
      renderFirstPurchaseTable();
      updateFirstPurchaseSummary();
    });
  }
  
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      filterAndSortFirstPurchaseData();
      renderFirstPurchaseTable();
      updateFirstPurchaseSummary();
    });
  }
  
  // Sort handlers
  const table = document.getElementById('firstPurchaseTable');
  if (table) {
    table.addEventListener('click', (e) => {
      const th = e.target.closest('[data-sort]');
      if (th) {
        const column = th.dataset.sort;
        if (firstPurchaseSortColumn === column) {
          firstPurchaseSortDirection = firstPurchaseSortDirection === 'asc' ? 'desc' : 'asc';
        } else {
          firstPurchaseSortColumn = column;
          firstPurchaseSortDirection = 'asc';
        }
        filterAndSortFirstPurchaseData();
        renderFirstPurchaseTable();
        updateFirstPurchaseSummary();
      }
    });
  }
}

// Setup listeners
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupFirstPurchaseListeners);
} else {
  setupFirstPurchaseListeners();
}

/* Vul kleine badge-spans rechts van de sliders */
function updateHistoricalBadges(churn, newBiz, avgRev) {
  const map = [
    ['churn',  `${churn.toFixed(1)} %`,
     'Gem. churn (laatste 3 mnd): aandeel normale klanten dat ≥ 3 mnd niets bestelde'],
    ['newBiz', `${newBiz.toFixed(1)} %`,
     'Gem. new business (laatste 3 mnd): nieuwe + gereactiveerde klanten (≥ 3 mnd inactief)'],
    ['growth', euro(avgRev),
     'Gem. omzet per normale klant over de afgelopen 3 maanden'],
  ];

  map.forEach(([id, val, tip]) => {
    const el = document.getElementById('hist-' + id);
    if (el) {
      el.textContent = val;
      el.title       = tip;          // browser-tooltip
    }
  });
}

/* -------------  TODO: supplier-filter, KPI-sliders, forecast, export ------------- */

// Bepaal aantal maanden voor forecast op basis van toggle en laatste historische maand
function computeForecastMonths() {
  try {
    if (!showExtraYears) return 18;
    // Vind laatste historische maand (via eerder opgeslagen keys)
    const keys = Array.isArray(window.latestMonthlyKeys) ? window.latestMonthlyKeys.slice() : [];
    let lastKey;
    if (keys.length) {
      lastKey = keys.sort().pop();
    } else if (rawRows && rawRows.length) {
      const d = rawRows
        .map(r => new Date(r.Jaar, (r.Maand || 1) - 1))
        .sort((a, b) => b - a)[0];
      lastKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    } else {
      const now = new Date();
      lastKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }
    const [y, m] = lastKey.split('-').map(Number);
    const start = new Date(y, m - 1);
    const targetEnd = new Date(new Date().getFullYear() + 3, 11, 1); // December van currentYear+3
    let months = 0;
    const tmp = new Date(start);
    while (tmp < targetEnd) {
      tmp.setMonth(tmp.getMonth() + 1);
      months++;
    }
    return Math.max(18, months);
  } catch {
    return 18;
  }
}

function updateArticleSelectionUI() {
  const article1Required = document.getElementById('article1Required');
  const article2Required = document.getElementById('article2Required');
  const article1Help = document.getElementById('article1Help');
  const article2Help = document.getElementById('article2Help');
  
  if (selectedCombinationType === 'flexible') {
    mainArticleSection.classList.remove('hidden');
    // Bij flexibele combinaties is alleen artikel 1 verplicht (één subartikel)
    article1Required.classList.remove('hidden');
    article2Required.classList.add('hidden'); // Artikel 2 is optioneel
    article1Help.classList.remove('hidden');
    article2Help.classList.add('hidden');
    // Update help tekst voor flexibele combinaties
    const article1HelpEl = document.getElementById('article1Help');
    if (article1HelpEl) article1HelpEl.textContent = 'Verplicht voor flexibele combinaties (subartikel)';
    // Reset artikelen bij type wijziging
    selectedArticles = [];
    clearArticleFields();
    
    // Herinitialiseer zoekbare velden na UI update
    setTimeout(() => {
      if (rawRows && rawRows.length > 0) {
        initializeSearchableInputs();
      }
    }, 100);
  } else {
    mainArticleSection.classList.add('hidden');
    // Bij vaste combinaties zijn alle artikelen verplicht
    article1Required.classList.remove('hidden');
    article2Required.classList.remove('hidden');
    article1Help.classList.remove('hidden');
    article2Help.classList.remove('hidden');
    // Update help tekst voor vaste combinaties
    const article1HelpEl = document.getElementById('article1Help');
    const article2HelpEl = document.getElementById('article2Help');
    if (article1HelpEl) article1HelpEl.textContent = 'Verplicht voor vaste combinaties';
    if (article2HelpEl) article2HelpEl.textContent = 'Verplicht voor vaste combinaties';
    // Reset artikelen bij type wijziging
    selectedArticles = [];
    clearArticleFields();
    
    // Herinitialiseer zoekbare velden na UI update
    setTimeout(() => {
      if (rawRows && rawRows.length > 0) {
        initializeSearchableInputs();
      }
    }, 100);
  }
}

function initializeSearchableInputs() {
  // Controleer of er data is
  if (!rawRows || rawRows.length === 0) return;
  
  // Haal unieke artikelen op uit de data
  const articles = [...new Set(rawRows.map(row => row.Artikel))].filter(a => a && a.trim()).sort();
  
  // Haal DOM elementen opnieuw op om er zeker van te zijn dat ze bestaan
  const mainArticleInputEl = document.getElementById('mainArticleInput');
  const mainArticleDropdownEl = document.getElementById('mainArticleDropdown');
  const article1InputEl = document.getElementById('article1Input');
  const article1DropdownEl = document.getElementById('article1Dropdown');
  const article2InputEl = document.getElementById('article2Input');
  const article2DropdownEl = document.getElementById('article2Dropdown');
  
  // Initialiseer alle zoekbare velden
  const inputs = [
    { input: mainArticleInputEl, dropdown: mainArticleDropdownEl, name: 'mainArticle' },
    { input: article1InputEl, dropdown: article1DropdownEl, name: 'article1' },
    { input: article2InputEl, dropdown: article2DropdownEl, name: 'article2' }
  ];
  
  inputs.forEach(({ input, dropdown, name }) => {
    if (input && dropdown) {
      // Verwijder bestaande event listeners door de input te vervangen
      const oldInput = input;
      const newInput = oldInput.cloneNode(true);
      oldInput.parentNode.replaceChild(newInput, oldInput);
      
      // Event listener voor input
      newInput.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        if (searchTerm.length === 0) {
          dropdown.classList.add('hidden');
          return;
        }
        
        // Filter artikelen op basis van zoekterm
        const filteredArticles = articles.filter(article => 
          article.toLowerCase().includes(searchTerm)
        );
        
        // Toon dropdown met resultaten
        showDropdown(dropdown, filteredArticles, newInput);
      });
      
      // Event listener voor focus
      newInput.addEventListener('focus', () => {
        if (newInput.value.length > 0) {
          const searchTerm = newInput.value.toLowerCase();
          const filteredArticles = articles.filter(article => 
            article.toLowerCase().includes(searchTerm)
          );
          showDropdown(dropdown, filteredArticles, newInput);
        }
      });
      
      // Event listener voor blur (verberg dropdown na korte vertraging)
      newInput.addEventListener('blur', () => {
        setTimeout(() => dropdown.classList.add('hidden'), 150);
      });
      
      // Update de globale referenties
      if (name === 'mainArticle') {
        mainArticleInput = newInput;
        mainArticleDropdown = dropdown;
      } else if (name === 'article1') {
        article1Input = newInput;
        article1Dropdown = dropdown;
      } else if (name === 'article2') {
        article2Input = newInput;
        article2Dropdown = dropdown;
      }
    }
  });
}

function showDropdown(dropdown, articles, input) {
  if (articles.length === 0) {
    dropdown.classList.add('hidden');
    return;
  }
  
  dropdown.innerHTML = articles.map(article => `
    <div class="px-3 py-2 hover:bg-gray-100 cursor-pointer border-b last:border-b-0" 
         data-value="${article}">
      ${article}
    </div>
  `).join('');
  
  // Event listeners voor dropdown items
  dropdown.querySelectorAll('[data-value]').forEach(item => {
    item.addEventListener('click', () => {
      input.value = item.dataset.value;
      dropdown.classList.add('hidden');
    });
  });
  
  dropdown.classList.remove('hidden');
}

function addArticleField() {
  const articleCount = additionalArticles.children.length + 3; // +3 omdat we al 2 hebben
  const articleDiv = document.createElement('div');
  articleDiv.className = 'grid md:grid-cols-2 gap-4';
  
  // Controleer of er data is
  if (!rawRows || rawRows.length === 0) {
    alert('Upload eerst CSV data om artikelen te kunnen selecteren.');
    return;
  }
  
  const articles = [...new Set(rawRows.map(row => row.Artikel))].filter(a => a && a.trim()).sort();
  
  // Bepaal of het artikel verplicht is op basis van het type
  const isRequired = true; // Alle artikelen zijn nu verplicht voor beide types
  const requiredMark = '<span class="text-red-500">*</span>';
  const helpText = selectedCombinationType === 'fixed' 
    ? '<p class="text-xs text-gray-500 mt-1">Verplicht voor vaste combinaties</p>'
    : '<p class="text-xs text-gray-500 mt-1">Verplicht voor flexibele combinaties (subartikel)</p>';
  
  articleDiv.innerHTML = `
    <div>
      <label class="block text-sm font-medium mb-2 text-gray-600">
        Artikel ${articleCount} ${requiredMark}
      </label>
      <div class="relative">
        <input type="text" class="article-input w-full px-3 py-2 border rounded-md focus:border-purple-500 focus:ring-2 focus:ring-purple-200" 
               placeholder="Type om te zoeken...">
        <div class="article-dropdown absolute z-10 w-full mt-1 bg-white border rounded-md shadow-lg max-h-60 overflow-y-auto hidden">
          <!-- Zoekresultaten worden hier dynamisch toegevoegd -->
        </div>
      </div>
      ${helpText}
    </div>
    <div class="flex items-end">
      <button class="remove-article-btn px-3 py-2 bg-red-500 text-white rounded-md hover:bg-red-600">
        🗑️ Verwijderen
      </button>
    </div>
  `;
  
  // Event listener voor verwijderen
  articleDiv.querySelector('.remove-article-btn').addEventListener('click', () => {
    articleDiv.remove();
  });
  
  // Initialiseer zoekfunctionaliteit voor dit veld
  const input = articleDiv.querySelector('.article-input');
  const dropdown = articleDiv.querySelector('.article-dropdown');
  
  if (input && dropdown) {
    // Event listener voor input
    input.addEventListener('input', (e) => {
      const searchTerm = e.target.value.toLowerCase();
      if (searchTerm.length === 0) {
        dropdown.classList.add('hidden');
        return;
      }
      
      // Filter artikelen op basis van zoekterm
      const filteredArticles = articles.filter(article => 
        article.toLowerCase().includes(searchTerm)
      );
      
      // Toon dropdown met resultaten
      showDropdown(dropdown, filteredArticles, input);
    });
    
    // Event listener voor focus
    input.addEventListener('focus', () => {
      if (input.value.length > 0) {
        const searchTerm = input.value.toLowerCase();
        const filteredArticles = articles.filter(article => 
          article.toLowerCase().includes(searchTerm)
        );
        showDropdown(dropdown, filteredArticles, input);
      }
    });
    
    // Event listener voor blur
    input.addEventListener('blur', () => {
      setTimeout(() => dropdown.classList.add('hidden'), 150);
    });
  }
  
  additionalArticles.appendChild(articleDiv);
}

function clearArticleFields() {
  additionalArticles.innerHTML = '';
  
  // Reset ook de hoofdinvoervelden
  if (mainArticleInput) mainArticleInput.value = '';
  if (article1Input) article1Input.value = '';
  if (article2Input) article2Input.value = '';
}

function getSelectedArticles() {
  const articles = [];
  
  if (selectedCombinationType === 'flexible') {
    const mainArticle = mainArticleInput.value;
    if (mainArticle) articles.push(mainArticle);
    
    // Voor flexibele combinaties is artikel 1 verplicht, artikel 2 is optioneel
    if (article1Input.value) articles.push(article1Input.value);
    if (article2Input.value) articles.push(article2Input.value);
    
    // Extra artikelen
    additionalArticles.querySelectorAll('.article-input').forEach(input => {
      if (input.value) articles.push(input.value);
    });
  } else {
    // Voor vaste combinaties zijn alle artikelen verplicht
    if (article1Input.value) articles.push(article1Input.value);
    if (article2Input.value) articles.push(article2Input.value);
    
    // Extra artikelen
    additionalArticles.querySelectorAll('.article-input').forEach(input => {
      if (input.value) articles.push(input.value);
    });
  }
  
  return articles;
}

function analyzeArticleCombinations() {
  // Controleer of er data is
  if (!rawRows || rawRows.length === 0) {
    alert('Upload eerst CSV data om de analyse uit te kunnen voeren.');
    return;
  }
  
  const articles = getSelectedArticles();
  
  if (articles.length < 1) {
    alert('Selecteer minimaal 1 artikel voor de analyse.');
    return;
  }
  
  // Voor flexibele combinaties moet er minimaal 2 artikelen zijn (hoofdartikel + minimaal 1 subartikel)
  if (selectedCombinationType === 'flexible' && articles.length < 2) {
    alert('Selecteer minimaal 1 hoofdartikel + 1 subartikel voor flexibele combinaties.');
    return;
  }
  
  // Voor vaste combinaties moeten er minimaal 2 artikelen zijn
  if (selectedCombinationType === 'fixed' && articles.length < 2) {
    alert('Selecteer minimaal 2 artikelen voor vaste combinaties.');
    return;
  }
  
  // Toon resultaten sectie
  combinationResults.classList.remove('hidden');
  
  // Voer analyse uit
  const analysis = performCombinationAnalysis(articles);
  
  // Sla de analyse op voor klantinformatie
  window.currentCombinationAnalysis = analysis;
  
  // Update de periode dropdown voor klantinformatie
  updateCustomerDetailPeriods(analysis);
  
  // Toon resultaten
  displayCombinationResults(analysis);
  
  // Maak grafiek
  createCombinationChart(analysis);
  
  // Vul tabel
  populateCombinationTable(analysis);
  
  // Toon maand op maand groei
  displayMonthlyGrowth(analysis);
}

function performCombinationAnalysis(articles) {
  // Filter data op basis van geselecteerde artikelen
  let filteredData = [];
  
  if (selectedCombinationType === 'fixed') {
    // Vaste combinatie: zoek transacties waar ALLE artikelen tegelijk voorkomen
    const customerMonths = new Map(); // klant + maand combinatie
    
    // Groepeer per klant en maand
    rawRows.forEach(row => {
      if (articles.includes(row.Artikel)) {
        const monthKey = `${row.Jaar}-${String(row.Maand).padStart(2, '0')}`; // YYYY-MM
        
        // Pas datumfilter toe als actief
        if (forecastDateFilterFromValue && monthKey < forecastDateFilterFromValue) return;
        if (forecastDateFilterToValue && monthKey > forecastDateFilterToValue) return;
        
        const key = `${row['Besteld door']}-${monthKey}`;
        if (!customerMonths.has(key)) {
          customerMonths.set(key, { articles: new Set(), total: 0, customer: row['Besteld door'], month: monthKey });
        }
        customerMonths.get(key).articles.add(row.Artikel);
        customerMonths.get(key).total += parseFloat(row.Factuurbedrag) || 0;
      }
    });
    
    // Filter alleen waar alle artikelen tegelijk voorkomen
    filteredData = Array.from(customerMonths.values())
      .filter(cm => cm.articles.size === articles.length)
      .map(cm => ({
        month: cm.month,
        customer: cm.customer,
        revenue: cm.total,
        quantity: cm.articles.size // Aantal unieke artikelen in de combinatie
      }));
      
  } else {
    // Flexibele combinatie: zoek transacties met hoofdartikel + optionele subartikelen
    const mainArticle = articles[0];
    const subArticles = articles.slice(1);
    
    const customerMonths = new Map();
    
    rawRows.forEach(row => {
      if (row.Artikel === mainArticle || subArticles.includes(row.Artikel)) {
        const monthKey = `${row.Jaar}-${String(row.Maand).padStart(2, '0')}`;
        
        // Pas datumfilter toe als actief
        if (forecastDateFilterFromValue && monthKey < forecastDateFilterFromValue) return;
        if (forecastDateFilterToValue && monthKey > forecastDateFilterToValue) return;
        
        const key = `${row['Besteld door']}-${monthKey}`;
        if (!customerMonths.has(key)) {
          customerMonths.set(key, { 
            mainArticle: false, 
            subArticles: new Set(), 
            total: 0, 
            customer: row['Besteld door'], 
            month: monthKey 
          });
        }
        
        if (row.Artikel === mainArticle) {
          customerMonths.get(key).mainArticle = true;
        } else {
          customerMonths.get(key).subArticles.add(row.Artikel);
        }
        
        customerMonths.get(key).total += parseFloat(row.Factuurbedrag) || 0;
      }
    });
    
    // Filter waar hoofdartikel + minimaal 1 subartikel aanwezig is
    filteredData = Array.from(customerMonths.values())
      .filter(cm => cm.mainArticle && cm.subArticles.size > 0) // Hoofdartikel + minimaal 1 subartikel
      .map(cm => ({
        month: cm.month,
        customer: cm.customer,
        revenue: cm.total,
        quantity: 1 + cm.subArticles.size // Hoofdartikel + aantal subartikelen
      }));
  }
  
  // Groepeer per maand
  const monthlyData = new Map();
  filteredData.forEach(item => {
    if (!monthlyData.has(item.month)) {
      monthlyData.set(item.month, { revenue: 0, quantity: 0, customers: new Set() });
    }
    monthlyData.get(item.month).revenue += item.revenue;
    monthlyData.get(item.month).quantity += item.quantity; // Dit is nu het aantal unieke artikelen per combinatie
    monthlyData.get(item.month).customers.add(item.customer);
  });
  
  // Converteer naar array en sorteer op datum
  const sortedData = Array.from(monthlyData.entries())
    .map(([month, data]) => ({
      month,
      revenue: data.revenue,
      quantity: data.quantity,
      customerCount: data.customers.size
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
  
  // Bereken forecast
  const forecast = calculateCombinationForecast(sortedData);
  
  return {
    articles,
    type: selectedCombinationType,
    historicalData: sortedData,
    forecast: forecast,
    summary: calculateCombinationSummary(sortedData, forecast)
  };
}

function calculateCombinationForecast(historicalData) {
  if (historicalData.length < 3) return [];
  
  const periods = parseInt(document.getElementById('forecastPeriod').value) || 12;
  const confidenceLevel = parseFloat(document.getElementById('confidenceLevel').value) || 0.95;
  
  // Bereken trendlijn
  const xValues = historicalData.map((_, i) => i);
  const yValues = historicalData.map(d => d.revenue);
  const { slope, intercept } = computeLinearRegression(xValues, yValues);
  
  // Bereken forecast
  const forecast = [];
  for (let i = 0; i < periods; i++) {
    const monthIndex = historicalData.length + i;
    const predictedRevenue = intercept + slope * monthIndex;
    
    // Bereken confidence interval
    const residuals = yValues.map((y, j) => y - (intercept + slope * j));
    const residualStd = Math.sqrt(residuals.reduce((sum, r) => sum + r * r, 0) / residuals.length);
    const confidenceInterval = residualStd * 1.96; // 95% confidence
    
    forecast.push({
      month: getNextMonth(historicalData[historicalData.length - 1].month, i + 1),
      revenue: Math.max(0, predictedRevenue),
      lowerBound: Math.max(0, predictedRevenue - confidenceInterval),
      upperBound: Math.max(0, predictedRevenue + confidenceInterval)
    });
  }
  
  return forecast;
}

function getNextMonth(currentMonth, offset) {
  const [year, month] = currentMonth.split('-').map(Number);
  let newMonth = month + offset;
  let newYear = year;
  
  while (newMonth > 12) {
    newMonth -= 12;
    newYear++;
  }
  
  return `${newYear}-${String(newMonth).padStart(2, '0')}`;
}

function calculateCombinationSummary(historicalData, forecast) {
  const totalRevenue = historicalData.reduce((sum, d) => sum + d.revenue, 0);
  const avgRevenue = totalRevenue / historicalData.length || 0;
  const totalCustomers = historicalData.reduce((sum, d) => sum + d.customerCount, 0);
  
  const forecastRevenue = forecast.reduce((sum, f) => sum + f.revenue, 0);
  
  return {
    totalRevenue,
    avgRevenue,
    totalCustomers,
    avgCustomersPerMonth: totalCustomers / historicalData.length || 0,
    forecastRevenue,
    totalPeriods: historicalData.length
  };
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
    </div>
  `;
}

function displayMonthlyGrowth(analysis) {
  const { historicalData, forecast } = analysis;
  
  if (historicalData.length < 2) {
    monthlyGrowthIndicator.classList.add('hidden');
    return;
  }
  
  // Bereken gemiddelde maand op maand groei gebaseerd op de trendlijn
  let avgMonthlyGrowth = 0;
  let trendStartRevenue = 0;
  let trendEndRevenue = 0;
  
  if (historicalData.length >= 2) {
    // Bereken lineaire regressie voor de trendlijn
    const xValues = historicalData.map((_, index) => index);
    const yValues = historicalData.map(d => d.revenue);
    const regression = computeLinearRegression(xValues, yValues);
    
    // Bereken trendlijn waarden voor eerste en laatste maand
    trendStartRevenue = regression.intercept + (regression.slope * 0);
    trendEndRevenue = regression.intercept + (regression.slope * (historicalData.length - 1));
    
    // Bereken gemiddelde maandelijkse groei gebaseerd op trendlijn
    if (trendStartRevenue > 0 && trendEndRevenue > 0) {
      const numberOfPeriods = historicalData.length - 1;
      const totalGrowthFactor = trendEndRevenue / trendStartRevenue;
      const monthlyGrowthFactor = Math.pow(totalGrowthFactor, 1 / numberOfPeriods);
      avgMonthlyGrowth = (monthlyGrowthFactor - 1) * 100;
    }
  }
  
  // Als fallback, gebruik het rekenkundig gemiddelde van de maandelijkse groeicijfers
  if (avgMonthlyGrowth === 0) {
    const monthlyGrowthRates = [];
    for (let i = 1; i < historicalData.length; i++) {
      const currentRevenue = historicalData[i].revenue;
      const previousRevenue = historicalData[i-1].revenue;
      if (previousRevenue > 0) {
        const growthRate = ((currentRevenue - previousRevenue) / previousRevenue) * 100;
        monthlyGrowthRates.push(growthRate);
      }
    }
    
    if (monthlyGrowthRates.length > 0) {
      avgMonthlyGrowth = monthlyGrowthRates.reduce((sum, rate) => sum + rate, 0) / monthlyGrowthRates.length;
    }
  }
  
  // Bepaal trend richting
  let trendDirectionText = '';
  let trendDirectionColor = '';
  
  if (avgMonthlyGrowth > 5) {
    trendDirectionText = 'Sterk stijgend 📈';
    trendDirectionColor = 'text-green-600';
  } else if (avgMonthlyGrowth > 1) {
    trendDirectionText = 'Stijgend ↗️';
    trendDirectionColor = 'text-green-600';
  } else if (avgMonthlyGrowth > -1) {
    trendDirectionText = 'Stabiel ➡️';
    trendDirectionColor = 'text-blue-600';
  } else if (avgMonthlyGrowth > -5) {
    trendDirectionText = 'Dalend ↘️';
    trendDirectionColor = 'text-orange-600';
  } else {
    trendDirectionText = 'Sterk dalend 📉';
    trendDirectionColor = 'text-red-600';
  }
  
  // Toon indicator
  monthlyGrowthValue.textContent = `${avgMonthlyGrowth.toFixed(1)}%`;
  trendDirection.textContent = trendDirectionText;
  trendDirection.className = `ml-1 text-sm font-medium ${trendDirectionColor}`;
  
  // Voeg uitleg toe over de berekening
  const explanation = document.getElementById('monthlyGrowthExplanation');
  if (explanation) {
    if (trendStartRevenue > 0 && trendEndRevenue > 0) {
      explanation.textContent = `Gebaseerd op trendlijn: van ${trendStartRevenue.toLocaleString('nl-NL', { style: 'currency', currency: 'EUR' })} naar ${trendEndRevenue.toLocaleString('nl-NL', { style: 'currency', currency: 'EUR' })} over ${historicalData.length - 1} maand(en)`;
    } else {
      explanation.textContent = `Gebaseerd op gemiddelde van maandelijkse groeicijfers`;
    }
  }
  
  monthlyGrowthIndicator.classList.remove('hidden');
}

function createCombinationChart(analysis) {
  const ctx = document.getElementById('combinationChart');
  
  // Vernietig bestaande chart als die er is
      if (combinationChartInstance) {
      combinationChartInstance.destroy();
    }
  
  const { historicalData, forecast } = analysis;
  
  // Combineer historische data en forecast
  const allLabels = [
    ...historicalData.map(d => d.month),
    ...forecast.map(f => f.month)
  ];
  
  const historicalRevenue = historicalData.map(d => d.revenue);
  const forecastRevenue = forecast.map(f => f.revenue);
  const forecastLower = forecast.map(f => f.lowerBound);
  const forecastUpper = forecast.map(f => f.upperBound);
  
  // Maak datasets
  const datasets = [
    {
      label: 'Historische omzet',
      data: [...historicalRevenue, ...new Array(forecast.length).fill(null)],
      borderColor: 'rgb(59, 130, 246)',
      backgroundColor: 'rgba(59, 130, 246, 0.1)',
      type: 'bar'
    }
  ];
  
  // Voeg forecast toe als checkbox is aangevinkt
  if (document.getElementById('showForecast').checked) {
    datasets.push({
      label: 'Forecast omzet',
      data: [...new Array(historicalData.length).fill(null), ...forecastRevenue],
      borderColor: 'rgb(147, 51, 234)',
      backgroundColor: 'rgba(147, 51, 234, 0.1)',
      type: 'line',
      borderWidth: 3
    });
    
    // Confidence interval
    datasets.push({
      label: 'Confidence interval',
      data: [...new Array(historicalData.length).fill(null), ...forecastUpper],
      borderColor: 'rgba(147, 51, 234, 0.3)',
      backgroundColor: 'rgba(147, 51, 234, 0.1)',
      type: 'line',
      borderDash: [5, 5],
      fill: '+1'
    });
    
    datasets.push({
      label: '',
      data: [...new Array(historicalData.length).fill(null), ...forecastLower],
      borderColor: 'rgba(147, 51, 234, 0.3)',
      backgroundColor: 'rgba(147, 51, 234, 0.1)',
      type: 'line',
      borderDash: [5, 5],
      fill: false
    });
  }
  
  // Trendlijn toevoegen als checkbox is aangevinkt
  if (document.getElementById('showTrendline').checked && historicalData.length >= 2) {
    const xValues = historicalData.map((_, i) => i);
    const yValues = historicalData.map(d => d.revenue);
    const { slope, intercept } = computeLinearRegression(xValues, yValues);
    
    const trendData = historicalData.map((_, i) => intercept + slope * i);
    
    datasets.push({
      label: 'Trendlijn',
      data: [...trendData, ...new Array(forecast.length).fill(null)],
      borderColor: 'rgb(239, 68, 68)',
      backgroundColor: 'rgba(239, 68, 68, 0.1)',
      type: 'line',
      borderWidth: 2,
      borderDash: [3, 3]
    });
  }
  
        combinationChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: allLabels,
      datasets: datasets
    },
    options: {
      responsive: true,
      plugins: {
        tooltip: { mode: 'index', intersect: false },
        legend: { position: 'bottom' }
      },
      scales: {
        x: { 
          type: 'category',
          title: { display: true, text: 'Periode' }
        },
        y: { 
          beginAtZero: true,
          title: { display: true, text: 'Omzet (€)' }
        }
      }
    }
  });
}

function populateCombinationTable(analysis) {
  const { historicalData, forecast } = analysis;
  
  // Combineer data
  const allData = [
    ...historicalData.map(d => ({ ...d, type: 'historical' })),
    ...forecast.map(f => ({ ...f, type: 'forecast' }))
  ];
  
  combinationTableBody.innerHTML = allData.map(item => `
    <tr class="border-b ${item.type === 'forecast' ? 'bg-purple-50' : ''}">
      <td class="px-3 py-2">${item.month}</td>
      <td class="px-3 py-2 text-right">${item.type === 'historical' ? 
        `${item.quantity} artikel${item.quantity > 1 ? 'en' : ''}` : '-'}</td>
      <td class="px-3 py-2 text-right">${item.type === 'historical' ? euro(item.revenue) : '-'}</td>
      <td class="px-3 py-2 text-right">${item.type === 'forecast' ? euro(item.revenue) : '-'}</td>
      <td class="px-3 py-2 text-right">${item.type === 'forecast' ? 
        `${euro(item.lowerBound)} - ${euro(item.upperBound)}` : '-'}</td>
    </tr>
  `).join('');
}

function exportCombinationDataToExcel() {
  // Implementeer Excel export functionaliteit
  alert('Excel export functionaliteit wordt geïmplementeerd...');
}

function exportCombinationChartAsImage() {
  if (combinationChart) {
    const link = document.createElement('a');
    link.download = 'artikelcombinaties-grafiek.png';
    link.href = combinationChartInstance.toBase64Image();
    link.click();
  }
}

// Forecast datumfilter handlers
function applyForecastDateFilterHandler() {
  forecastDateFilterFromValue = forecastDateFilterFrom.value;
  forecastDateFilterToValue = forecastDateFilterTo.value;
  
  // Validatie
  if (forecastDateFilterFromValue && forecastDateFilterToValue && forecastDateFilterFromValue > forecastDateFilterToValue) {
    alert('De "vanaf datum" moet voor de "tot datum" liggen.');
    return;
  }
  
  // Voer analyse opnieuw uit met nieuwe datumfilter
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
  
  // Voer analyse opnieuw uit zonder datumfilter
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

/* -------------  GEDETAILLEERDE KLANTINFORMATIE ------------- */

// DOM elementen voor klantinformatie
const customerDetailPeriod = document.getElementById('customerDetailPeriod');
const refreshCustomerDetails = document.getElementById('refreshCustomerDetails');
const customerDetailsSection = document.getElementById('customerDetailsSection');
const periodSummaryTitle = document.getElementById('periodSummaryTitle');
const totalCustomersCount = document.getElementById('totalCustomersCount');
const totalPeriodRevenue = document.getElementById('totalPeriodRevenue');
const avgRevenuePerCustomer = document.getElementById('avgRevenuePerCustomer');
const customerDetailsTableBody = document.getElementById('customerDetailsTableBody');

// Event listeners voor klantinformatie
document.addEventListener('DOMContentLoaded', () => {
  if (refreshCustomerDetails) {
    refreshCustomerDetails.addEventListener('click', loadCustomerDetails);
  }
  if (customerDetailPeriod) {
    customerDetailPeriod.addEventListener('change', loadCustomerDetails);
  }
});

// Vul de periode dropdown met beschikbare periodes
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

// Laad gedetailleerde klantinformatie voor een specifieke periode
function loadCustomerDetails() {
  const selectedPeriod = customerDetailPeriod.value;
  
  if (!selectedPeriod) {
    customerDetailsSection.classList.add('hidden');
    return;
  }
  
  // Haal de huidige analyse op
  const currentAnalysis = getCurrentAnalysis();
  if (!currentAnalysis) {
    alert('Voer eerst een artikelcombinatie analyse uit.');
    return;
  }
  
  // Toon de sectie
  customerDetailsSection.classList.remove('hidden');
  
  // Haal klantdetails op voor de geselecteerde periode
  const customerDetails = getCustomerDetailsForPeriod(selectedPeriod, currentAnalysis);
  
  // Toon samenvatting
  displayCustomerDetailsSummary(selectedPeriod, customerDetails);
  
  // Vul de tabel
  populateCustomerDetailsTable(customerDetails);
}

// Haal de huidige analyse op (wordt aangeroepen na analyse)
function getCurrentAnalysis() {
  // Deze functie wordt aangeroepen na een succesvolle analyse
  // De data wordt opgeslagen in een globale variabele
  return window.currentCombinationAnalysis || null;
}

// Haal klantdetails op voor een specifieke periode
function getCustomerDetailsForPeriod(period, analysis) {
  const { articles, type, historicalData } = analysis;
  
  // Zoek de geselecteerde periode in de historische data
  const periodData = historicalData.find(d => d.month === period);
  if (!periodData) return [];
  
  // Haal alle transacties op voor deze periode en artikelen
  let periodTransactions = [];
  
  if (type === 'fixed') {
    // Vaste combinatie: zoek transacties waar ALLE artikelen tegelijk voorkomen
    const customerMonths = new Map();
    
    rawRows.forEach(row => {
      if (articles.includes(row.Artikel)) {
        const monthKey = `${row.Jaar}-${String(row.Maand).padStart(2, '0')}`;
        if (monthKey === period) {
          const key = `${row['Besteld door']}-${row.Artikel}`;
          if (!customerMonths.has(key)) {
            customerMonths.set(key, {
              customer: row['Besteld door'],
              article: row.Artikel,
              quantity: 0,
              revenue: 0
            });
          }
          customerMonths.get(key).quantity += 1;
          customerMonths.get(key).revenue += parseFloat(row.Factuurbedrag) || 0;
        }
      }
    });
    
    // Groepeer per klant
    const customerGroups = new Map();
    customerMonths.forEach((data, key) => {
      if (!customerGroups.has(data.customer)) {
        customerGroups.set(data.customer, {
          customer: data.customer,
          articles: [],
          totalQuantity: 0,
          totalRevenue: 0
        });
      }
      
      // Controleer of dit artikel al bestaat voor deze klant
      const existingArticle = customerGroups.get(data.customer).articles.find(a => a.article === data.article);
      if (existingArticle) {
        // Tel de hoeveelheden op als het artikel al bestaat
        existingArticle.quantity += data.quantity;
        existingArticle.revenue += data.revenue;
      } else {
        // Voeg nieuw artikel toe
        customerGroups.get(data.customer).articles.push({
          article: data.article,
          quantity: data.quantity,
          revenue: data.revenue
        });
      }
      
      customerGroups.get(data.customer).totalQuantity += data.quantity;
      customerGroups.get(data.customer).totalRevenue += data.revenue;
    });
    
    // Filter alleen klanten die ALLE artikelen hebben
    periodTransactions = Array.from(customerGroups.values())
      .filter(cg => cg.articles.length === articles.length)
      .map(cg => ({
        customer: cg.customer,
        articles: cg.articles.map(a => `${a.article} (${a.quantity}x)`).join(', '),
        quantity: cg.totalQuantity,
        revenue: cg.totalRevenue,
        type: 'Vaste combinatie'
      }));
      
  } else {
    // Flexibele combinatie: zoek transacties met hoofdartikel + optionele subartikelen
    const mainArticle = articles[0];
    const subArticles = articles.slice(1);
    
    const customerMonths = new Map();
    
    rawRows.forEach(row => {
      if (row.Artikel === mainArticle || subArticles.includes(row.Artikel)) {
        const monthKey = `${row.Jaar}-${String(row.Maand).padStart(2, '0')}`;
        if (monthKey === period) {
          const key = `${row['Besteld door']}-${row.Artikel}`;
          if (!customerMonths.has(key)) {
            customerMonths.set(key, {
              customer: row['Besteld door'],
              article: row.Artikel,
              quantity: 0,
              revenue: 0
            });
          }
          customerMonths.get(key).quantity += 1;
          customerMonths.get(key).revenue += parseFloat(row.Factuurbedrag) || 0;
        }
      }
    });
    
    // Groepeer per klant
    const customerGroups = new Map();
    customerMonths.forEach((data, key) => {
      if (!customerGroups.has(data.customer)) {
        customerGroups.set(data.customer, {
          customer: data.customer,
          mainArticle: false,
          subArticles: [],
          totalQuantity: 0,
          totalRevenue: 0
        });
      }
      
      if (data.article === mainArticle) {
        customerGroups.get(data.customer).mainArticle = true;
      } else {
        // Controleer of dit subartikel al bestaat voor deze klant
        const existingSubArticle = customerGroups.get(data.customer).subArticles.find(a => a.article === data.article);
        if (existingSubArticle) {
          // Tel de hoeveelheden op als het subartikel al bestaat
          existingSubArticle.quantity += data.quantity;
          existingSubArticle.revenue += data.revenue;
        } else {
          // Voeg nieuw subartikel toe
          customerGroups.get(data.customer).subArticles.push({
            article: data.article,
            quantity: data.quantity,
            revenue: data.revenue
          });
        }
      }
      
      customerGroups.get(data.customer).totalQuantity += data.quantity;
      customerGroups.get(data.customer).totalRevenue += data.revenue;
    });
    
    // Filter klanten met hoofdartikel + minimaal 1 subartikel
    periodTransactions = Array.from(customerGroups.values())
      .filter(cg => cg.mainArticle && cg.subArticles.length > 0) // Alleen combinaties, geen losse hoofdartikelen
      .map(cg => {
        const type = `Hoofdartikel + ${cg.subArticles.length} subartikel${cg.subArticles.length > 1 ? 'en' : ''}`;
        
        // Zoek de werkelijke hoeveelheid van het hoofdartikel uit de originele data
        let mainArticleQuantity = 0;
        rawRows.forEach(row => {
          if (row.Artikel === mainArticle && 
              row['Besteld door'] === cg.customer && 
              `${row.Jaar}-${String(row.Maand).padStart(2, '0')}` === period) {
            mainArticleQuantity += 1;
          }
        });
        
        const allArticles = [
          { article: mainArticle, quantity: mainArticleQuantity, revenue: 0 }, // Hoofdartikel met werkelijke hoeveelheid
          ...cg.subArticles
        ];
        
        return {
          customer: cg.customer,
          articles: allArticles.map(a => `${a.article} (${a.quantity}x)`).join(', '),
          quantity: cg.totalQuantity,
          revenue: cg.totalRevenue,
          type: type
        };
      });
  }
  
  return periodTransactions;
}

// Toon samenvatting van klantdetails
function displayCustomerDetailsSummary(period, customerDetails) {
  const totalCustomers = customerDetails.length;
  const totalRevenue = customerDetails.reduce((sum, cd) => sum + cd.revenue, 0);
  const avgRevenue = totalCustomers > 0 ? totalRevenue / totalCustomers : 0;
  
  periodSummaryTitle.textContent = `Periode: ${period}`;
  totalCustomersCount.textContent = totalCustomers;
  totalPeriodRevenue.textContent = euro(totalRevenue);
  avgRevenuePerCustomer.textContent = euro(avgRevenue);
}

// Vul de klantdetails tabel
function populateCustomerDetailsTable(customerDetails) {
  customerDetailsTableBody.innerHTML = customerDetails.map(cd => `
    <tr class="border-b hover:bg-gray-50">
      <td class="px-3 py-2 font-medium">${cd.customer}</td>
      <td class="px-3 py-2 text-sm">${cd.articles}</td>
      <td class="px-3 py-2 text-right">${cd.quantity}</td>
      <td class="px-3 py-2 text-right font-medium">${euro(cd.revenue)}</td>
      <td class="px-3 py-2 text-center">
        <span class="px-2 py-1 text-xs rounded-full ${
          cd.type.includes('Vaste') ? 'bg-purple-100 text-purple-800' :
          cd.type.includes('Hoofdartikel alleen') ? 'bg-blue-100 text-blue-800' :
          'bg-green-100 text-green-800'
        }">${cd.type}</span>
      </td>
    </tr>
  `).join('');
}

// Update de periode dropdown wanneer een analyse wordt uitgevoerd
// Artikelcombinaties functionaliteit is verplaatst naar HTML/js/combinations.js
