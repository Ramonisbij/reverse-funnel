/* funnel.js
   Commerciële Acties & Funnel Forecast Tool (Redesign)
   =================================================== */

// Data structure voor layer-gebaseerde funnel
let funnelLayers = {
  see: [],      // Top-funnel: blogs, social, ads
  think: [],   // Mid-funnel: webinars, trainingen
  do: [],      // 1-op-1, joint visits
  care: []     // Klanten
};

// Standaard conversieratios per actietype
const defaultActionTypes = {
  'blog': { 
    name: 'Blog/Social Post', 
    layer: 'see',
    defaultRatios: { think: 2 }, // 2% gaat naar think-layer
    color: '#9ca3af'
  },
  'ad': { 
    name: 'Advertentie', 
    layer: 'see',
    defaultRatios: { think: 5 }, 
    color: '#6b7280'
  },
  'webinar': { 
    name: 'Webinar', 
    layer: 'think',
    defaultRatios: { customer: 0, '1on1': 20 }, // 0% direct klant, 20% naar 1-op-1
    color: '#3b82f6'
  },
  'training': { 
    name: 'Training', 
    layer: 'think',
    defaultRatios: { customer: 25, '1on1': 50 }, // 25% direct klant, 50% naar 1-op-1
    color: '#10b981'
  },
  '1on1': { 
    name: '1-op-1 Gesprek', 
    layer: 'do',
    defaultRatios: { customer: 50 }, // 50% wordt klant
    color: '#8b5cf6'
  },
  'joint-visit': { 
    name: 'Joint Visit', 
    layer: 'do',
    defaultRatios: { customer: 70 }, // 70% wordt klant
    color: '#f59e0b'
  },
  'customer': { 
    name: 'Directe Klant', 
    layer: 'care',
    defaultRatios: {}, 
    color: '#22c55e'
  }
};

let actionTypes = { ...defaultActionTypes };
let naturalFlow = { start: '', perMonth: 0 };
let monthlyResults = {};

// Helper: genereer unieke ID
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// Render action in layer
function renderActionInLayer(action) {
  const type = actionTypes[action.typeId];
  if (!type) return '';
  
  const ratios = action.conversions || {};
  const totalConv = Object.values(ratios).reduce((sum, r) => sum + (r.percentage || 0), 0);
  
  return `
    <div class="action-card bg-white border-2 rounded-lg p-3 mb-2 hover:shadow-md transition-shadow" 
         data-action-id="${action.id}" style="border-color: ${type.color}">
      <div class="flex items-start justify-between mb-2">
        <div class="flex-1">
          <div class="flex items-center gap-2 mb-1">
            <div class="w-3 h-3 rounded" style="background-color: ${type.color}"></div>
            <span class="font-semibold text-sm">${type.name}</span>
            ${action.audience ? `<span class="text-xs text-gray-500">(${action.audience} bereikt)</span>` : ''}
          </div>
          ${action.recurring && action.recurring !== 'once' ? `
            <div class="text-xs text-gray-500">
              ${action.recurring === 'monthly' ? '📅 Maandelijks' : 
                action.recurring === 'quarterly' ? '📅 Per kwartaal' : 
                action.recurring === '2x-quarterly' ? '📅 2x per kwartaal' : ''}
              ${action.startMonth ? ` vanaf ${formatMonthShort(action.startMonth)}` : ''}
            </div>
          ` : ''}
        </div>
        <button onclick="removeAction('${action.id}')" class="text-red-600 hover:text-red-800 text-sm px-1">×</button>
      </div>
      
      ${action.audience ? `
        <div class="text-xs space-y-1">
          ${ratios.customer ? `
            <div class="flex justify-between">
              <span class="text-gray-600">→ Klant:</span>
              <span class="font-medium">${ratios.customer.count || 0} (${ratios.customer.percentage || 0}%)</span>
            </div>
          ` : ''}
          ${ratios['1on1'] ? `
            <div class="flex justify-between">
              <span class="text-gray-600">→ 1-op-1:</span>
              <span class="font-medium">${ratios['1on1'].count || 0} (${ratios['1on1'].percentage || 0}%)</span>
            </div>
          ` : ''}
          ${ratios.think ? `
            <div class="flex justify-between">
              <span class="text-gray-600">→ Think:</span>
              <span class="font-medium">${ratios.think.count || 0} (${ratios.think.percentage || 0}%)</span>
            </div>
          ` : ''}
        </div>
      ` : ''}
      
      <button onclick="editAction('${action.id}')" class="mt-2 text-xs text-blue-600 hover:text-blue-800">
        ✏️ Bewerken
      </button>
    </div>
  `;
}

// Render all layers
function renderLayers() {
  ['see', 'think', 'do', 'care'].forEach(layer => {
    const container = document.querySelector(`[data-layer-id="${layer}"]`);
    if (!container) return;
    
    const actions = funnelLayers[layer];
    if (actions.length === 0) {
      container.innerHTML = `<p class="text-sm text-gray-500 text-center">Klik op "+ Actie" om te beginnen</p>`;
    } else {
      container.innerHTML = actions.map(action => renderActionInLayer(action)).join('');
    }
  });
}

// Add action to layer
function addActionToLayer(layer) {
  openActionModal(null, layer);
}

// Open modal to add/edit action
function openActionModal(actionId = null, layer = null) {
  const modal = document.getElementById('actionModal');
  const modalTitle = document.getElementById('modalTitle');
  const modalContent = document.getElementById('modalContent');
  
  const action = actionId ? findActionById(actionId) : null;
  const targetLayer = layer || action?.layer || 'think';
  
  modalTitle.textContent = action ? 'Actie bewerken' : 'Nieuwe actie toevoegen';
  
  // Get available action types for this layer
  const availableTypes = Object.entries(actionTypes).filter(([id, type]) => type.layer === targetLayer);
  
  modalContent.innerHTML = `
    <form id="actionForm" class="space-y-4" data-editing-action="${actionId || ''}">
      <div>
        <label class="block text-sm font-medium mb-1">Actietype</label>
        <select id="modalTypeSelect" class="w-full px-3 py-2 border rounded-md" required>
          ${availableTypes.map(([id, type]) => 
            `<option value="${id}" ${action?.typeId === id ? 'selected' : ''}>${type.name}</option>`
          ).join('')}
        </select>
      </div>
      
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-sm font-medium mb-1">Aantal bereikt/audience</label>
          <input type="number" id="modalAudience" 
                 class="w-full px-3 py-2 border rounded-md" 
                 value="${action?.audience || ''}" 
                 min="0" required>
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">Startmaand</label>
          <input type="month" id="modalStartMonth" 
                 class="w-full px-3 py-2 border rounded-md" 
                 value="${action?.startMonth || ''}">
        </div>
      </div>
      
      <div>
        <label class="block text-sm font-medium mb-1">Recurring patroon</label>
        <select id="modalRecurring" class="w-full px-3 py-2 border rounded-md">
          <option value="once" ${action?.recurring === 'once' ? 'selected' : ''}>Eenmalig</option>
          <option value="monthly" ${action?.recurring === 'monthly' ? 'selected' : ''}>Maandelijks</option>
          <option value="quarterly" ${action?.recurring === 'quarterly' ? 'selected' : ''}>Per kwartaal</option>
          <option value="2x-quarterly" ${action?.recurring === '2x-quarterly' ? 'selected' : ''}>2x per kwartaal</option>
        </select>
      </div>
      
      <div id="modalConversions" class="space-y-2">
        <!-- Wordt dynamisch gevuld op basis van type -->
      </div>
      
      ${targetLayer !== 'see' ? `
        <div class="border-t pt-4">
          <h4 class="font-medium mb-2 text-sm">Wat brengt mensen naar deze actie?</h4>
          <div id="modalSources" class="space-y-2">
            ${action?.sources && action.sources.length > 0 ? 
              action.sources.map((sourceId, idx) => {
                const sourceAction = findActionById(sourceId);
                return sourceAction ? `
                  <div class="flex items-center justify-between bg-gray-50 p-2 rounded">
                    <span class="text-sm">${actionTypes[sourceAction.typeId]?.name || 'Onbekend'}</span>
                    <button type="button" onclick="removeSource(${idx})" class="text-red-600 text-xs">×</button>
                  </div>
                ` : '';
              }).join('') : 
              '<p class="text-xs text-gray-500">Klik op "+ Bron toevoegen" om acties te koppelen die mensen naar deze actie brengen</p>'
            }
          </div>
          <button type="button" onclick="showSourceSelector('${targetLayer}')" class="mt-2 text-xs text-blue-600 hover:text-blue-800">
            + Bron toevoegen
          </button>
        </div>
      ` : ''}
      
      <div class="flex gap-2 pt-4">
        <button type="submit" class="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
          ${action ? 'Bijwerken' : 'Toevoegen'}
        </button>
        <button type="button" onclick="closeModal()" class="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300">
          Annuleren
        </button>
      </div>
    </form>
  `;
  
  // Load default ratios for selected type
  setTimeout(() => updateModalConversions(), 10);
  
  // Event listeners
  const typeSelect = document.getElementById('modalTypeSelect');
  if (typeSelect) {
    typeSelect.addEventListener('change', updateModalConversions);
  }
  
  const form = document.getElementById('actionForm');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      saveActionFromModal(actionId, targetLayer);
    });
  }
  
  modal.classList.remove('hidden');
}

// Update conversions in modal based on selected type
function updateModalConversions() {
  const typeSelect = document.getElementById('modalTypeSelect');
  if (!typeSelect) return;
  
  const typeId = typeSelect.value;
  const type = actionTypes[typeId];
  const container = document.getElementById('modalConversions');
  
  if (!type || !container) return;
  
  // Get current action being edited (if any)
  const currentActionId = document.querySelector('[data-editing-action]')?.dataset.editingAction;
  const action = currentActionId ? findActionById(currentActionId) : null;
  
  // Determine which conversions are possible for this layer
  const possibleConversions = [];
  if (type.layer === 'see') {
    possibleConversions.push({ key: 'think', label: '→ Think (webinars/trainingen)' });
  } else if (type.layer === 'think') {
    possibleConversions.push({ key: 'customer', label: '→ Direct Klant' });
    possibleConversions.push({ key: '1on1', label: '→ 1-op-1 Gesprek' });
  } else if (type.layer === 'do') {
    possibleConversions.push({ key: 'customer', label: '→ Klant' });
  }
  
  container.innerHTML = `
    <h4 class="font-medium mb-2 text-sm">Conversies:</h4>
    ${possibleConversions.map(conv => {
      const defaultPct = type.defaultRatios?.[conv.key] || 0;
      const currentPct = action?.conversions?.[conv.key]?.percentage || defaultPct;
      return `
        <div class="flex items-center gap-2">
          <label class="flex-1 text-sm">${conv.label}:</label>
          <input type="number" 
                 id="conv-${conv.key}"
                 class="w-20 px-2 py-1 border rounded text-sm" 
                 value="${currentPct}" 
                 min="0" max="100" step="0.1">
          <span class="text-xs text-gray-500">%</span>
          <span id="conv-count-${conv.key}" class="text-xs text-gray-400 w-16 text-right"></span>
        </div>
      `;
    }).join('')}
  `;
  
  // Update counts when audience or percentages change
  const audienceInput = document.getElementById('modalAudience');
  const updateCounts = () => {
    const audience = parseInt(audienceInput.value) || 0;
    possibleConversions.forEach(conv => {
      const pctInput = document.getElementById(`conv-${conv.key}`);
      const countEl = document.getElementById(`conv-count-${conv.key}`);
      if (pctInput && countEl) {
        const pct = parseFloat(pctInput.value) || 0;
        const count = Math.round(audience * pct / 100);
        countEl.textContent = `(${count})`;
      }
    });
  };
  
  if (audienceInput) {
    audienceInput.addEventListener('input', updateCounts);
    possibleConversions.forEach(conv => {
      const pctInput = document.getElementById(`conv-${conv.key}`);
      if (pctInput) pctInput.addEventListener('input', updateCounts);
    });
    updateCounts();
  }
}

// Save action from modal
function saveActionFromModal(actionId, layer) {
  const typeId = document.getElementById('modalTypeSelect').value;
  const audience = parseInt(document.getElementById('modalAudience').value) || 0;
  const startMonth = document.getElementById('modalStartMonth').value;
  const recurring = document.getElementById('modalRecurring').value;
  
  const type = actionTypes[typeId];
  const conversions = {};
  
  // Get conversion percentages from inputs
  ['customer', '1on1', 'think'].forEach(key => {
    const input = document.getElementById(`conv-${key}`);
    if (input) {
      const percentage = parseFloat(input.value) || 0;
      const count = Math.round(audience * percentage / 100);
      if (percentage > 0 || conversions[key]) { // Only add if > 0 or was already set
        conversions[key] = { percentage, count };
      }
    }
  });
  
  // Get sources
  const sources = [];
  const sourcesDiv = document.getElementById('modalSources');
  if (sourcesDiv) {
    sourcesDiv.querySelectorAll('[data-source-id]').forEach(el => {
      sources.push(el.dataset.sourceId);
    });
  }
  
  const newAction = {
    id: actionId || generateId(),
    typeId,
    layer,
    audience,
    startMonth,
    recurring,
    conversions,
    sources: sources
  };
  
  // Remove old action if editing
  if (actionId) {
    removeAction(actionId, false);
  }
  
  // Add to layer
  funnelLayers[layer].push(newAction);
  
  closeModal();
  renderLayers();
  calculateForecast();
  saveData();
}

// Find action by ID
function findActionById(actionId) {
  for (const layer in funnelLayers) {
    const action = funnelLayers[layer].find(a => a.id === actionId);
    if (action) return action;
  }
  return null;
}

// Remove action
function removeAction(actionId, update = true) {
  for (const layer in funnelLayers) {
    funnelLayers[layer] = funnelLayers[layer].filter(a => a.id !== actionId);
  }
  if (update) {
    renderLayers();
    calculateForecast();
    saveData();
  }
}

// Edit action
function editAction(actionId) {
  const action = findActionById(actionId);
  if (action) {
    openActionModal(actionId, action.layer);
  }
}

// Close modal
function closeModal() {
  document.getElementById('actionModal').classList.add('hidden');
}

// Format month short
function formatMonthShort(monthKey) {
  if (!monthKey) return '';
  const [year, month] = monthKey.split('-');
  const monthNames = ['Jan', 'Feb', 'Mrt', 'Apr', 'Mei', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec'];
  return `${monthNames[parseInt(month) - 1]} ${year}`;
}

// Calculate forecast
function calculateForecast() {
  const startDate = new Date();
  const months = [];
  for (let i = 0; i < 18; i++) {
    const d = new Date(startDate);
    d.setMonth(d.getMonth() + i);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  
  monthlyResults = {};
  months.forEach(m => {
    monthlyResults[m] = {
      fromActions: 0,
      fromNaturalFlow: 0,
      manualOverride: null
    };
  });
  
  // Process natural flow
  if (naturalFlow.start && naturalFlow.perMonth > 0) {
    const startIdx = months.findIndex(m => m >= naturalFlow.start);
    if (startIdx !== -1) {
      for (let i = startIdx; i < months.length; i++) {
        monthlyResults[months[i]].fromNaturalFlow = naturalFlow.perMonth;
      }
    }
  }
  
  // Track audience flow through layers (top to bottom)
  const layerAudience = {}; // { month: { layer: audience } }
  months.forEach(m => {
    layerAudience[m] = { see: 0, think: 0, do: 0, care: 0 };
  });
  
  // Process from top to bottom (see -> think -> do -> care)
  ['see', 'think', 'do', 'care'].forEach(layer => {
    funnelLayers[layer].forEach(action => {
      if (!action.startMonth) return;
      
      const actionMonths = getActionMonths(action.startMonth, action.recurring);
      
      actionMonths.forEach(month => {
        if (!monthlyResults[month]) return;
        
        // Calculate actual audience for this action
        let actualAudience = action.audience || 0;
        
        // If action has sources, calculate audience from those sources
        if (action.sources && action.sources.length > 0) {
          let sourceAudience = 0;
          action.sources.forEach(sourceId => {
            const sourceAction = findActionById(sourceId);
            if (sourceAction) {
              const sourceLayer = sourceAction.layer;
              const sourceMonths = getActionMonths(sourceAction.startMonth, sourceAction.recurring);
              
              // Find when source action happened (or previous month if recurring)
              const sourceMonth = sourceMonths.find(m => m <= month) || sourceMonths[0];
              if (sourceMonth && layerAudience[sourceMonth]) {
                const sourceConversions = sourceAction.conversions || {};
                const conversionKey = layer === 'think' ? 'think' : 
                                    layer === 'do' ? '1on1' : 
                                    layer === 'care' ? 'customer' : null;
                
                if (conversionKey && sourceConversions[conversionKey]) {
                  sourceAudience += sourceConversions[conversionKey].count || 0;
                }
              }
            }
          });
          actualAudience = sourceAudience;
        }
        
        // Update audience for this layer
        layerAudience[month][layer] += actualAudience;
        
        const conversions = action.conversions || {};
        
        // Process conversions
        if (conversions.customer && layer === 'care') {
          // Direct customers
          monthlyResults[month].fromActions += Math.round(actualAudience * (conversions.customer.percentage || 0) / 100);
        } else if (conversions['1on1'] && layer === 'do') {
          // 1-on-1 conversions
          const oneon1Count = Math.round(actualAudience * (conversions['1on1'].percentage || 0) / 100);
          // Convert to customer (50% default, can be overridden)
          const customerConv = conversions.customer || {};
          const customerRate = customerConv.percentage || 50;
          monthlyResults[month].fromActions += Math.round(oneon1Count * customerRate / 100);
        } else if (conversions.customer && layer !== 'care') {
          // Direct customer conversion from think/do layer
          monthlyResults[month].fromActions += Math.round(actualAudience * (conversions.customer.percentage || 0) / 100);
        }
        
        // Store converted audience for next layer
        if (conversions.think && layer === 'see') {
          layerAudience[month].think += Math.round(actualAudience * (conversions.think.percentage || 0) / 100);
        }
        if (conversions['1on1'] && layer === 'think') {
          layerAudience[month].do += Math.round(actualAudience * (conversions['1on1'].percentage || 0) / 100);
        }
      });
    });
  });
  
  // Render results
  renderForecastTable(months, monthlyResults);
  renderForecastChart(months, monthlyResults);
}

// Get action months based on recurring pattern
function getActionMonths(startMonth, recurring) {
  const [startYear, startMonthNum] = startMonth.split('-').map(Number);
  const startDate = new Date(startYear, startMonthNum - 1);
  const months = [];
  const endDate = new Date(startDate);
  endDate.setMonth(endDate.getMonth() + 18);
  
  let current = new Date(startDate);
  
  if (recurring === 'once') {
    months.push(startMonth);
  } else if (recurring === 'monthly') {
    while (current < endDate) {
      months.push(`${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`);
      current.setMonth(current.getMonth() + 1);
    }
  } else if (recurring === 'quarterly') {
    while (current < endDate) {
      months.push(`${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`);
      current.setMonth(current.getMonth() + 3);
    }
  } else if (recurring === '2x-quarterly') {
    let count = 0;
    while (current < endDate && count < 12) {
      months.push(`${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`);
      current.setMonth(current.getMonth() + 1.5);
      count++;
      if (count % 2 === 0) {
        const quarter = Math.floor(current.getMonth() / 3);
        const nextQuarter = Math.floor((current.getMonth() + 1.5) / 3);
        if (nextQuarter > quarter) {
          const nextQuarterStart = new Date(current.getFullYear(), quarter * 3 + 3, 1);
          current = nextQuarterStart;
        }
      }
    }
  }
  
  return months;
}

// Render forecast table
function renderForecastTable(months, results) {
  const tbody = document.getElementById('outputTableBody');
  if (!tbody) return;
  
  tbody.innerHTML = months.map(month => {
    const r = results[month];
    const total = r.manualOverride !== null ? r.manualOverride : (r.fromActions + r.fromNaturalFlow);
    return `
      <tr class="border-b hover:bg-gray-50">
        <td class="py-2 px-3">${formatMonthShort(month)}</td>
        <td class="text-right py-2 px-3">${Math.round(r.fromActions)}</td>
        <td class="text-right py-2 px-3">${Math.round(r.fromNaturalFlow)}</td>
        <td class="text-right py-2 px-3 font-semibold">${Math.round(total)}</td>
        <td class="py-2 px-3">
          <input type="number" class="manual-override w-20 px-2 py-1 border rounded text-sm" 
                 data-month="${month}" value="${r.manualOverride !== null ? r.manualOverride : ''}" 
                 placeholder="-" min="0">
        </td>
      </tr>
    `;
  }).join('');
  
  document.querySelectorAll('.manual-override').forEach(input => {
    input.addEventListener('input', (e) => {
      const month = e.target.dataset.month;
      const value = e.target.value === '' ? null : parseInt(e.target.value);
      results[month].manualOverride = value;
      calculateForecast();
    });
  });
}

// Render forecast chart
let funnelChart = null;
function renderForecastChart(months, results) {
  const ctx = document.getElementById('funnelChart');
  if (!ctx) return;
  
  const labels = months.map(formatMonthShort);
  const fromActions = months.map(m => Math.round(results[m].fromActions));
  const fromNatural = months.map(m => Math.round(results[m].fromNaturalFlow));
  const totals = months.map(m => {
    const r = results[m];
    return Math.round(r.manualOverride !== null ? r.manualOverride : (r.fromActions + r.fromNaturalFlow));
  });
  
  if (funnelChart) {
    funnelChart.data.labels = labels;
    funnelChart.data.datasets[0].data = fromActions;
    funnelChart.data.datasets[1].data = fromNatural;
    funnelChart.data.datasets[2].data = totals;
    funnelChart.update();
  } else {
    funnelChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Van Acties',
            data: fromActions,
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            tension: 0.4
          },
          {
            label: 'Natuurlijk Verloop',
            data: fromNatural,
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            tension: 0.4
          },
          {
            label: 'Totaal',
            data: totals,
            borderColor: '#f59e0b',
            backgroundColor: 'rgba(245, 158, 11, 0.1)',
            tension: 0.4,
            borderWidth: 2
          }
        ]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: true },
          tooltip: { mode: 'index', intersect: false }
        },
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0 } }
        }
      }
    });
  }
}

// Save configuration
function saveFunnelConfig() {
  const config = {
    funnelLayers,
    actionTypes,
    naturalFlow,
    timestamp: new Date().toISOString(),
    version: '2.0'
  };
  
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `funnel-config-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

// Load configuration
function loadFunnelConfig(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const config = JSON.parse(e.target.result);
      
      if (config.funnelLayers) funnelLayers = config.funnelLayers;
      if (config.actionTypes) actionTypes = { ...defaultActionTypes, ...config.actionTypes };
      if (config.naturalFlow) naturalFlow = { ...naturalFlow, ...config.naturalFlow };
      
      renderLayers();
      
      const naturalStart = document.getElementById('naturalFlowStart');
      const naturalPerMonth = document.getElementById('naturalFlowPerMonth');
      if (naturalStart) naturalStart.value = naturalFlow.start || '';
      if (naturalPerMonth) naturalPerMonth.value = naturalFlow.perMonth || 0;
      
      calculateForecast();
      saveData();
      alert('Configuratie geladen!');
    } catch (err) {
      alert('Fout bij laden: ' + err.message);
    }
  };
  reader.readAsText(file);
}

// Export to CSV
function exportToCSV() {
  const months = Object.keys(monthlyResults || {}).sort();
  if (months.length === 0) {
    alert('Geen data om te exporteren');
    return;
  }
  
  const csv = [
    ['Maand', 'Van Acties', 'Natuurlijk Verloop', 'Totaal', 'Handmatig Override'].join(','),
    ...months.map(m => {
      const r = monthlyResults[m];
      const total = r.manualOverride !== null ? r.manualOverride : (r.fromActions + r.fromNaturalFlow);
      return [
        formatMonthShort(m),
        Math.round(r.fromActions),
        Math.round(r.fromNaturalFlow),
        Math.round(total),
        r.manualOverride !== null ? r.manualOverride : ''
      ].join(',');
    })
  ].join('\n');
  
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `funnel-forecast-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

// Save to localStorage
function saveData() {
  try {
    localStorage.setItem('funnelData', JSON.stringify({
      funnelLayers,
      actionTypes,
      naturalFlow
    }));
  } catch (e) {}
}

// Load from localStorage
function loadData() {
  try {
    const saved = localStorage.getItem('funnelData');
    if (saved) {
      const data = JSON.parse(saved);
      if (data.funnelLayers) funnelLayers = data.funnelLayers;
      if (data.actionTypes) actionTypes = { ...defaultActionTypes, ...data.actionTypes };
      if (data.naturalFlow) naturalFlow = { ...naturalFlow, ...data.naturalFlow };
    }
  } catch (e) {}
}

// Make functions global
window.addActionToLayer = addActionToLayer;
window.removeAction = removeAction;
window.editAction = editAction;
window.closeModal = closeModal;
window.showSourceSelector = showSourceSelector;

// Show source selector
function showSourceSelector(targetLayer) {
  // Get actions from layer above
  const upperLayers = {
    'think': 'see',
    'do': 'think',
    'care': 'do'
  };
  
  const sourceLayer = upperLayers[targetLayer];
  if (!sourceLayer) return;
  
  const availableSources = funnelLayers[sourceLayer] || [];
  if (availableSources.length === 0) {
    alert(`Voeg eerst acties toe aan de ${getLayerName(sourceLayer)} laag`);
    return;
  }
  
  // Show dropdown or modal to select source
  const sourceId = prompt(`Selecteer welke actie mensen naar deze actie brengt:\n\n${
    availableSources.map((a, i) => `${i + 1}. ${actionTypes[a.typeId]?.name || 'Onbekend'}`).join('\n')
  }\n\nVoer nummer in:`, '1');
  
  if (sourceId) {
    const idx = parseInt(sourceId) - 1;
    if (idx >= 0 && idx < availableSources.length) {
      // Add to current action being edited
      const form = document.getElementById('actionForm');
      if (form) {
        const sourcesDiv = document.getElementById('modalSources');
        const selectedSource = availableSources[idx];
        sourcesDiv.innerHTML += `
          <div class="flex items-center justify-between bg-gray-50 p-2 rounded mb-2" data-source-id="${selectedSource.id}">
            <span class="text-sm">${actionTypes[selectedSource.typeId]?.name || 'Onbekend'}</span>
            <button type="button" onclick="this.parentElement.remove()" class="text-red-600 text-xs">×</button>
          </div>
        `;
      }
    }
  }
}

function removeSource(index) {
  // TODO: Implement
}

// Render default ratios panel
function renderDefaultRatios() {
  const container = document.getElementById('defaultRatiosList');
  if (!container) return;
  
  container.innerHTML = Object.entries(actionTypes).map(([id, type]) => {
    const defaults = type.defaultRatios || {};
    return `
      <div class="p-3 border rounded-md bg-gray-50">
        <div class="flex items-center gap-2 mb-2">
          <div class="w-4 h-4 rounded" style="background-color: ${type.color}"></div>
          <span class="font-medium text-sm">${type.name}</span>
          <span class="text-xs text-gray-500">(${getLayerName(type.layer)})</span>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
          ${Object.entries(defaults).map(([key, value]) => {
            const label = key === 'customer' ? '→ Klant' : 
                         key === '1on1' ? '→ 1-op-1' :
                         key === 'think' ? '→ Think' : key;
            return `
              <div class="flex items-center gap-1">
                <label class="w-20 text-gray-600">${label}:</label>
                <input type="number" 
                       class="default-ratio-input flex-1 px-2 py-1 border rounded" 
                       data-type-id="${id}" 
                       data-ratio-key="${key}"
                       value="${value}" 
                       min="0" max="100" step="0.1">
                <span class="text-gray-500">%</span>
              </div>
            `;
          }).join('')}
          ${Object.keys(defaults).length === 0 ? '<span class="text-gray-400">Geen conversies</span>' : ''}
        </div>
      </div>
    `;
  }).join('');
  
  // Attach listeners
  document.querySelectorAll('.default-ratio-input').forEach(input => {
    input.addEventListener('change', (e) => {
      const typeId = e.target.dataset.typeId;
      const key = e.target.dataset.ratioKey;
      const value = parseFloat(e.target.value) || 0;
      if (actionTypes[typeId]) {
        if (!actionTypes[typeId].defaultRatios) actionTypes[typeId].defaultRatios = {};
        actionTypes[typeId].defaultRatios[key] = value;
        saveData();
      }
    });
  });
}

function getLayerName(layer) {
  const names = {
    see: 'See',
    think: 'Think',
    do: 'Do',
    care: 'Care'
  };
  return names[layer] || layer;
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadData();
  
  // Layer buttons
  document.querySelectorAll('.add-to-layer-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const layer = e.target.dataset.layer;
      addActionToLayer(layer);
    });
  });
  
  // Close modal
  document.getElementById('closeModal').addEventListener('click', closeModal);
  document.getElementById('actionModal').addEventListener('click', (e) => {
    if (e.target.id === 'actionModal') closeModal();
  });
  
  // Natural flow
  const naturalStart = document.getElementById('naturalFlowStart');
  const naturalPerMonth = document.getElementById('naturalFlowPerMonth');
  
  if (naturalStart) {
    naturalStart.value = naturalFlow.start;
    naturalStart.addEventListener('change', (e) => {
      naturalFlow.start = e.target.value;
      saveData();
      calculateForecast();
    });
  }
  
  if (naturalPerMonth) {
    naturalPerMonth.value = naturalFlow.perMonth;
    naturalPerMonth.addEventListener('input', (e) => {
      naturalFlow.perMonth = parseInt(e.target.value) || 0;
      saveData();
      calculateForecast();
    });
  }
  
  // Save/Load
  document.getElementById('saveConfigBtn').addEventListener('click', saveFunnelConfig);
  document.getElementById('loadConfigBtn').addEventListener('click', () => {
    document.getElementById('loadConfigInput').click();
  });
  document.getElementById('loadConfigInput').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) loadFunnelConfig(file);
    e.target.value = '';
  });
  
  // Toggle defaults
  document.getElementById('toggleDefaultsBtn').addEventListener('click', () => {
    const panel = document.getElementById('defaultRatiosPanel');
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) {
      renderDefaultRatios();
    }
  });
  
  // Initial render
  renderLayers();
  renderDefaultRatios();
  calculateForecast();
});
