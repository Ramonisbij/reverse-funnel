/* funnel-reverse.js
   Reverse Funnel Calculator
   Start met aantal nieuwe klanten per maand en werk naar boven
   =================================================== */

// Data structure
let funnelData = {
  startMode: 'customers',
  baseValue: 4,
  churnRate: 0,
  conversions: {
    reachToLeads: 2,
    leadsToConversation: 30,
    conversationToOrder: 40,
    orderToCustomer: 80
  },
  nurture: {
    enabled: false,
    captureRate: 0,
    conversionRate: 0,
    delayMonths: 1
  },
  activities: {
    seeToLeads: [], // Activities that help Reach → Leads (e.g., Webinar, Email campaign)
    thinkToOneOnOne: [], // Activities that help Leads → 1-on-1 (e.g., Sales call, Follow-up)
    doToOrders: [], // Activities that help 1-on-1 → Orders (e.g., Product demo, Proposal)
    careToCustomers: [], // Activities that help Orders → Customers (e.g., Onboarding, Support)
    customerActivities: [] // Activities for New Customers (e.g., Welcome email, Onboarding, Retention)
  }
};

const START_MODE_CONFIG = {
  customers: {
    title: 'CARE - New Customers',
    description: 'Start here: how many new customers per month?',
    label: 'New customers per month',
    placeholder: 'e.g. 4',
    helper: 'The number of new customers you want to acquire per month',
    infoLabel: 'Target:',
    summaryLabel: 'Target new customers:',
    showChurn: true,
    defaultValue: 4
  },
  oneonone: {
    title: "DO - 1-on-1's",
    description: 'Start with the number of 1-on-1 interactions you expect per month.',
    label: "1-on-1's per month",
    placeholder: 'e.g. 20',
    helper: 'Number of 1-on-1 interactions you expect per month',
    infoLabel: 'Result:',
    summaryLabel: "New customers (result):",
    showChurn: false,
    defaultValue: 20
  },
  leads: {
    title: 'THINK - Leads',
    description: 'Start with the number of leads you expect per month.',
    label: 'Leads per month',
    placeholder: 'e.g. 120',
    helper: 'Number of leads you expect per month',
    infoLabel: 'Result:',
    summaryLabel: 'New customers (result):',
    showChurn: false,
    defaultValue: 120
  },
  reach: {
    title: 'SEE - Reach',
    description: 'Start with the amount of reach at the top of the funnel.',
    label: 'Reach per month',
    placeholder: 'e.g. 5000',
    helper: 'Number of people you reach per month',
    infoLabel: 'Result:',
    summaryLabel: 'New customers (result):',
    showChurn: false,
    defaultValue: 5000
  }
};

const safeMultiply = (value, rate) => (rate > 0 ? value * rate : 0);
const safeDivide = (value, rate) => (rate > 0 ? value / rate : 0);

// Activity management
const ACTIVITY_LAYER_CONFIG = {
  seeToLeads: {
    label: 'Reach → Leads',
    placeholder: 'e.g., Webinar, Email campaign',
    color: 'gray' // Neutral color for all activities
  },
  thinkToOneOnOne: {
    label: 'Leads → 1-on-1',
    placeholder: 'e.g., Sales call, Follow-up email',
    color: 'gray' // Neutral color for all activities
  },
  doToOrders: {
    label: '1-on-1 → Orders',
    placeholder: 'e.g., Product demo, Proposal, Installation help, Roadshow',
    color: 'gray' // Neutral color for all activities
  },
  careToCustomers: {
    label: 'Orders → Customers',
    placeholder: 'e.g., Onboarding, Support, Welcome email',
    color: 'gray' // Neutral color for all activities
  },
  customerActivities: {
    label: 'New Customers',
    placeholder: 'e.g., Welcome email, Onboarding, Retention',
    color: 'gray' // Neutral color for all activities
  }
};

// Make addActivity globally accessible
window.addActivity = function(layer) {
  const activityName = prompt(`Enter activity name for ${ACTIVITY_LAYER_CONFIG[layer]?.label || layer}:`);
  if (!activityName || !activityName.trim()) return;
  
  if (!funnelData.activities[layer]) {
    funnelData.activities[layer] = [];
  }
  
  const newActivity = {
    id: Date.now().toString(),
    name: activityName.trim()
  };
  
  funnelData.activities[layer].push(newActivity);
  renderActivities();
  saveData();
  
  // Re-render funnel to show activities
  if (currentFunnelData) {
    renderFunnelChart(currentFunnelData);
  }
};

// Make removeActivity globally accessible
window.removeActivity = function(layer, activityId) {
  if (!funnelData.activities[layer]) return;
  
  funnelData.activities[layer] = funnelData.activities[layer].filter(a => a.id !== activityId);
  renderActivities();
  saveData();
  
  // Re-render funnel
  if (currentFunnelData) {
    renderFunnelChart(currentFunnelData);
  }
};

function renderActivities() {
  Object.keys(ACTIVITY_LAYER_CONFIG).forEach(layer => {
    const container = document.getElementById(`activities-${layer}`);
    if (!container) return;
    
    const activities = funnelData.activities[layer] || [];
    const config = ACTIVITY_LAYER_CONFIG[layer];
    
    if (activities.length === 0) {
      container.innerHTML = '<p class="text-[10px] text-gray-400 italic">No activities added yet</p>';
      return;
    }
    
    container.innerHTML = activities.map(activity => {
      const colorClasses = {
        gray: 'bg-gray-50 border-gray-200 text-gray-700',
        blue: 'bg-blue-50 border-blue-200 text-blue-700',
        purple: 'bg-purple-50 border-purple-200 text-purple-700',
        orange: 'bg-orange-50 border-orange-200 text-orange-700',
        green: 'bg-green-50 border-green-200 text-green-700'
      };
      
      return `
        <div class="flex items-center justify-between p-1.5 rounded border ${colorClasses[config.color] || 'bg-gray-50'}">
          <span class="text-[10px] font-medium">${escapeHtml(activity.name)}</span>
          <button type="button" onclick="removeActivity('${layer}', '${activity.id}')" 
                  class="text-[10px] text-red-600 hover:text-red-800 ml-1.5">
            ×
          </button>
        </div>
      `;
    }).join('');
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function updateNurtureFromInputs() {
  const enabled = !!document.getElementById('nurtureEnabled')?.checked;
  funnelData.nurture.enabled = enabled;
  funnelData.nurture.captureRate = parseFloat(document.getElementById('nurtureCapture')?.value) || 0;
  funnelData.nurture.conversionRate = parseFloat(document.getElementById('nurtureConversion')?.value) || 0;
  funnelData.nurture.delayMonths = Math.max(0, parseInt(document.getElementById('nurtureDelay')?.value || '0', 10) || 0);
  applyNurtureUI({ setValues: false });
}

function applyNurtureUI({ setValues = false } = {}) {
  const enabled = !!funnelData.nurture?.enabled;
  const toggle = document.getElementById('nurtureEnabled');
  if (toggle) {
    toggle.checked = enabled;
  }
  const settings = document.getElementById('nurtureSettings');
  if (settings) {
    settings.classList.toggle('hidden', !enabled);
  }

  if (setValues) {
    const captureInput = document.getElementById('nurtureCapture');
    const conversionInput = document.getElementById('nurtureConversion');
    const delayInput = document.getElementById('nurtureDelay');
    if (captureInput) captureInput.value = funnelData.nurture.captureRate ?? 0;
    if (conversionInput) conversionInput.value = funnelData.nurture.conversionRate ?? 0;
    if (delayInput) delayInput.value = funnelData.nurture.delayMonths ?? 0;
  }
}

function applyStartModeConfig(options = {}) {
  const { preserveValue = false } = options;
  const mode = funnelData.startMode in START_MODE_CONFIG ? funnelData.startMode : 'customers';
  const config = START_MODE_CONFIG[mode];

  const startModeSelect = document.getElementById('startMode');
  if (startModeSelect) {
    startModeSelect.value = mode;
  }

  const titleEl = document.getElementById('startModeTitle');
  if (titleEl) titleEl.textContent = config.title;

  const descriptionEl = document.getElementById('startModeDescription');
  if (descriptionEl) descriptionEl.textContent = config.description;

  const labelEl = document.getElementById('startValueLabel');
  if (labelEl) labelEl.textContent = config.label;

  const helperEl = document.getElementById('startValueDescription');
  if (helperEl) helperEl.textContent = config.helper;

  const infoLabelEl = document.getElementById('startInfoLabel');
  if (infoLabelEl) infoLabelEl.textContent = config.infoLabel;

  const summaryStatusLabel = document.getElementById('summaryStatusLabel');
  if (summaryStatusLabel) summaryStatusLabel.textContent = config.summaryLabel;

  const startValueInput = document.getElementById('startValueInput');
  if (startValueInput) {
    startValueInput.placeholder = config.placeholder;
    if (!preserveValue) {
      const valueToApply = funnelData.baseValue ?? config.defaultValue;
      startValueInput.value = valueToApply;
    }
  }

  const churnWrapper = document.getElementById('churnInputWrapper');
  if (churnWrapper) {
    churnWrapper.classList.toggle('hidden', !config.showChurn);
  }

  if (!config.showChurn) {
    const churnInfo = document.getElementById('churnInfo');
    if (churnInfo) churnInfo.classList.add('hidden');
  }
}

let currentFunnelData = null;
let showConversionRates = false;
const MONTH_COUNT = 12;
let monthlyTimeline = [];
let monthlyTimelineMonths = [];

// Bereken reverse funnel
function calculateReverseFunnel() {
  const startModeSelect = document.getElementById('startMode');
  if (startModeSelect) {
    funnelData.startMode = startModeSelect.value || funnelData.startMode;
  }

  applyStartModeConfig({ preserveValue: true });
  updateNurtureFromInputs();

  const config = START_MODE_CONFIG[funnelData.startMode] || START_MODE_CONFIG.customers;

  const startValueInput = document.getElementById('startValueInput');
  const startValue = parseFloat(startValueInput?.value) || config.defaultValue || 0;
  funnelData.baseValue = startValue;

  const churnInput = document.getElementById('churnRate');
  let churnRate = 0;
  if (config.showChurn) {
    churnRate = parseFloat(churnInput?.value) || 0;
  } else if (churnInput) {
    churnInput.value = 0;
  }
  funnelData.churnRate = config.showChurn ? churnRate : 0;

  const reachToLeadsPct = parseFloat(document.getElementById('convReachToLeads')?.value) || 0;
  const leadsToConversationPct = parseFloat(document.getElementById('convLeadsToConversation')?.value) || 0;
  const conversationToOrderPct = parseFloat(document.getElementById('convConversationToOrder')?.value) || 0;
  const orderToCustomerPct = parseFloat(document.getElementById('convOrderToCustomer')?.value) || 0;
 
  const nurtureCaptureRate = (funnelData.nurture.captureRate || 0) / 100;
  const nurtureConversionRate = (funnelData.nurture.conversionRate || 0) / 100;

  funnelData.conversions.reachToLeads = reachToLeadsPct;
  funnelData.conversions.leadsToConversation = leadsToConversationPct;
  funnelData.conversions.conversationToOrder = conversationToOrderPct;
  funnelData.conversions.orderToCustomer = orderToCustomerPct;

  const reachRate = reachToLeadsPct / 100;
  const leadsRate = leadsToConversationPct / 100;
  const conversationRate = conversationToOrderPct / 100;
  const orderRate = orderToCustomerPct / 100;

  let reach = 0;
  let leads = 0;
  let oneonone = 0;
  let orders = 0;
  let customers = 0;

  switch (funnelData.startMode) {
    case 'reach': {
      reach = startValue;
      leads = safeMultiply(reach, reachRate);
      oneonone = safeMultiply(leads, leadsRate);
      orders = safeMultiply(oneonone, conversationRate);
      customers = safeMultiply(orders, orderRate);
      break;
    }
    case 'leads': {
      leads = startValue;
      reach = safeDivide(leads, reachRate);
      oneonone = safeMultiply(leads, leadsRate);
      orders = safeMultiply(oneonone, conversationRate);
      customers = safeMultiply(orders, orderRate);
      break;
    }
    case 'oneonone': {
      oneonone = startValue;
      leads = safeDivide(oneonone, leadsRate);
      reach = safeDivide(leads, reachRate);
      orders = safeMultiply(oneonone, conversationRate);
      customers = safeMultiply(orders, orderRate);
      break;
    }
    case 'customers':
    default: {
      const baseCustomers = startValue;
      let totalCustomers = baseCustomers;
      if (config.showChurn && churnRate > 0 && baseCustomers > 0) {
        const customersToReplace = baseCustomers * (churnRate / 100);
        totalCustomers += customersToReplace;
        updateElement('customersToReplace', Math.ceil(customersToReplace));
        updateElement('totalNewCustomersNeeded', Math.ceil(totalCustomers));
        const churnInfoEl = document.getElementById('churnInfo');
        if (churnInfoEl) churnInfoEl.classList.remove('hidden');
        const summaryChurnRow = document.getElementById('summaryChurnRow');
        if (summaryChurnRow) summaryChurnRow.classList.remove('hidden');
        updateElement('summaryChurn', Math.ceil(customersToReplace));
      } else {
        const churnInfoEl = document.getElementById('churnInfo');
        if (churnInfoEl) churnInfoEl.classList.add('hidden');
        const summaryChurnRow = document.getElementById('summaryChurnRow');
        if (summaryChurnRow) summaryChurnRow.classList.add('hidden');
        updateElement('customersToReplace', 0);
        updateElement('totalNewCustomersNeeded', Math.ceil(totalCustomers));
      }
      customers = totalCustomers;
      orders = safeDivide(customers, orderRate);
      oneonone = safeDivide(orders, conversationRate);
      leads = safeDivide(oneonone, leadsRate);
      reach = safeDivide(leads, reachRate);
      break;
    }
  }

  if (!config.showChurn) {
    const churnInfoEl = document.getElementById('churnInfo');
    if (churnInfoEl) churnInfoEl.classList.add('hidden');
    const summaryChurnRow = document.getElementById('summaryChurnRow');
    if (summaryChurnRow) summaryChurnRow.classList.add('hidden');
    updateElement('customersToReplace', 0);
    updateElement('totalNewCustomersNeeded', Math.ceil(customers));
  }

  const baseFlow = {
    reach,
    leads,
    oneOnOne: oneonone,
    orders,
    customers
  };

  const conversions = {
    reachRate,
    leadsRate,
    conversationRate,
    orderRate
  };

  const timeline = buildMonthlyTimeline(baseFlow, conversions, funnelData, MONTH_COUNT);
  monthlyTimeline = timeline;
  monthlyTimelineMonths = generateMonthKeys(MONTH_COUNT);
  renderYearPlanner(monthlyTimelineMonths, timeline);

  const monthZero = timeline[0] || { totals: baseFlow, extras: { leads: 0, oneOnOne: 0, orders: 0, customers: 0 } };
  const totals = monthZero.totals || baseFlow;
  const extras = monthZero.extras || { leads: 0, oneOnOne: 0, orders: 0, customers: 0 };

  updateElement('reachNeeded', totals.reach);
  updateElement('leadsNeeded', totals.leads);
  updateElement('leadsNeededFromDo', totals.leads);
  updateElement('conversationsNeeded', totals.oneOnOne);
  updateElement('ordersNeeded', totals.orders);
  updateElement('totalLeadsGenerated', totals.leads);
  updateElement('totalReachGenerated', totals.reach);
  updateElement('reachNeededFromThink', totals.reach);
  updateElement('targetNewCustomers', totals.customers);

  updateElement('summaryReach', totals.reach);
  updateElement('summaryLeads', totals.leads);
  updateElement('summaryConversations', totals.oneOnOne);
  updateElement('summaryOrders', totals.orders);
  updateElement('summaryNewCustomers', totals.customers);
  updateElement('summaryTargetCustomers', totals.customers);
  updateElement('totalNewCustomersNeeded', Math.ceil(totals.customers));

  const leadsStatusEl = document.getElementById('leadsStatus');
  if (leadsStatusEl) {
    if (extras.leads > 0) {
      leadsStatusEl.innerHTML = `<span class="text-indigo-600">+${Math.round(extras.leads).toLocaleString('nl-NL')} leads re-engaged via nurture</span>`;
    } else {
      leadsStatusEl.textContent = '';
    }
  }

  const reachStatusEl = document.getElementById('reachStatus');
  if (reachStatusEl) {
    if (extras.customers > 0) {
      reachStatusEl.innerHTML = `<span class="text-emerald-600">+${Math.round(extras.customers).toLocaleString('nl-NL')} customers from nurture</span>`;
    } else {
      reachStatusEl.textContent = '';
    }
  }

  const totalDrop = Math.max(0, baseFlow.reach - baseFlow.leads) + Math.max(0, baseFlow.leads - baseFlow.oneOnOne) + Math.max(0, baseFlow.oneOnOne - baseFlow.orders);
  const chartData = {
    reach: Math.ceil(totals.reach),
    leads: Math.ceil(totals.leads),
    conversations: Math.ceil(totals.oneOnOne),
    orders: Math.ceil(totals.orders),
    newCustomers: Math.ceil(totals.customers),
    nurtureCaptured: Math.ceil(totalDrop * nurtureCaptureRate),
    nurtureReturning: Math.ceil(totalDrop * nurtureCaptureRate * nurtureConversionRate)
  };

  currentFunnelData = chartData;
  const primaryWrapper = document.getElementById('primaryFunnelWrapper');
  const showPrimary = document.getElementById('showPrimaryFunnelToggle')?.checked ?? true;
  if (primaryWrapper) primaryWrapper.classList.toggle('hidden', !showPrimary);
  if (showPrimary) {
    renderFunnelChart(chartData);
  }

  const nurtureWrapper = document.getElementById('nurtureFunnelWrapper');
  const showNurture = document.getElementById('showNurtureFunnelToggle')?.checked ?? true;
  if (nurtureWrapper) nurtureWrapper.classList.toggle('hidden', !showNurture);
  if (showNurture) {
    renderNurtureFunnelChart(chartData);
  }
 
  saveData();
}

// Helper: update element text
function updateElement(id, value) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = typeof value === 'number' ? Math.ceil(value) : value;
  }
}

function formatPercentage(value) {
  if (isNaN(value)) return '0%';
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
}

// Render funnel chart (custom canvas funnel visualization)
function renderFunnelChart(data) {
  const canvas = document.getElementById('funnelChart');
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d');
  const labels = ['Reach', 'Leads', "1-on-1's", 'First orders', 'Returning customers'];
  const values = [
    data.reach,
    data.leads,
    data.conversations,
    data.orders,
    data.newCustomers
  ];
  
  // Set canvas size based on container
  const container = canvas.parentElement;
  if (container) {
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width || 400;
    canvas.height = 600; // Increased height for better visibility
    canvas.style.width = '100%';
    canvas.style.height = '600px';
  }
  
  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  const padding = 40;
  const funnelTop = padding;
  const funnelBottom = canvas.height - padding;
  const funnelHeight = funnelBottom - funnelTop;
  const maxValue = Math.max(...values.filter(v => v > 0));
  
  if (maxValue <= 0) return;
  
  const numSegments = values.filter(v => v > 0).length;
  const segmentHeight = funnelHeight / numSegments;
  
  const colors = getFunnelColors();
  const borderColors = getFunnelBorderColors();
  
  // Filter out zero values for proper indexing
  const validIndices = values.map((v, i) => v > 0 ? i : -1).filter(i => i !== -1);
  let segmentIndex = 0;
  
  const conversionMeta = [
    { label: 'Reach → Leads', value: funnelData.conversions.reachToLeads || 0 },
    { label: 'Leads → 1-on-1', value: funnelData.conversions.leadsToConversation || 0 },
    { label: "1-on-1 → First orders", value: funnelData.conversions.conversationToOrder || 0 },
    { label: 'First orders → Returning customers', value: funnelData.conversions.orderToCustomer || 0 }
  ];
  
  // Draw funnel segments
  labels.forEach((label, index) => {
    const value = values[index];
    if (value <= 0) return;
    
    const y = funnelTop + (segmentIndex * segmentHeight);
    const nextY = funnelTop + ((segmentIndex + 1) * segmentHeight);
    
    // Calculate widths for funnel effect
    // Funnel goes from wide (top) to narrow (bottom)
    const maxWidth = canvas.width - (padding * 2);
    const minWidth = maxWidth * 0.25; // Minimum width for smallest segment (25%)
    
    // Calculate width based on position in funnel (not value)
    // First segment (index 0) is widest, last is narrowest
    const totalSegments = validIndices.length;
    const positionRatio = totalSegments > 1 ? segmentIndex / (totalSegments - 1) : 0; // 0 to 1
    const widthScale = 1 - (positionRatio * 0.75); // From 100% to 25%
    
    const currentWidth = maxWidth * widthScale;
    
    // Previous segment width (for top of trapezoid)
    let prevWidth;
    if (segmentIndex === 0) {
      prevWidth = currentWidth; // Top segment starts with same width
    } else {
      const prevPositionRatio = totalSegments > 1 ? (segmentIndex - 1) / (totalSegments - 1) : 0;
      const prevWidthScale = 1 - (prevPositionRatio * 0.75);
      prevWidth = maxWidth * prevWidthScale;
    }
    
    // Draw trapezoid with gradient effect
    const topX = (canvas.width - prevWidth) / 2;
    const bottomX = (canvas.width - currentWidth) / 2;
    
    // Create gradient for depth effect
    const gradient = ctx.createLinearGradient(topX, y, bottomX, nextY);
    const baseColor = colors[index];
    gradient.addColorStop(0, baseColor);
    gradient.addColorStop(1, adjustBrightness(baseColor, -15));
    
    ctx.fillStyle = gradient;
    ctx.strokeStyle = borderColors[index];
    ctx.lineWidth = 2.5;
    
    ctx.beginPath();
    ctx.moveTo(topX, y);
    ctx.lineTo(topX + prevWidth, y);
    ctx.lineTo(bottomX + currentWidth, nextY);
    ctx.lineTo(bottomX, nextY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    
    // Always draw text inside segments (they're now large enough)
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    const lines = [
      { text: label, font: 'bold 20px sans-serif' },
      { text: value.toLocaleString('nl-NL'), font: '16px sans-serif' }
    ];
    
    if (showConversionRates && segmentIndex < conversionMeta.length) {
      const conv = conversionMeta[segmentIndex];
      lines.push({ text: `${conv.label}: ${formatPercentage(conv.value)}`, font: '14px sans-serif' });
    }
    
    const lineSpacing = 18;
    const totalHeight = (lines.length - 1) * lineSpacing;
    const startY = y + (segmentHeight / 2) - totalHeight / 2;
    
    // Add text shadow for better readability
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;
    
    lines.forEach((line, i) => {
      ctx.font = line.font;
      ctx.fillText(line.text, canvas.width / 2, startY + i * lineSpacing);
    });
    
    // Reset shadow
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    
    segmentIndex++;
  });
  
  // Draw activities next to funnel segments
  drawActivities(ctx, canvas, padding, funnelTop, funnelBottom, validIndices, segmentHeight);
}

function drawActivities(ctx, canvas, padding, funnelTop, funnelBottom, validIndices, segmentHeight) {
  // Map of original label index to activity layer
  const activityMapping = [
    { layer: 'seeToLeads', fromIndex: 0, toIndex: 1 }, // Between Reach (0) and Leads (1)
    { layer: 'thinkToOneOnOne', fromIndex: 1, toIndex: 2 }, // Between Leads (1) and 1-on-1 (2)
    { layer: 'doToOrders', fromIndex: 2, toIndex: 3 }, // Between 1-on-1 (2) and Orders (3)
    { layer: 'careToCustomers', fromIndex: 3, toIndex: 4 } // Between Orders (3) and Customers (4)
  ];
  
  const maxWidth = canvas.width - (padding * 2);
  const funnelCenterX = canvas.width / 2;
  const totalSegments = validIndices.length;
  
  // Draw activities between segments
  activityMapping.forEach(({ layer, fromIndex, toIndex }) => {
    const activities = funnelData.activities[layer] || [];
    if (activities.length === 0) return;
    
    // Find segment positions in validIndices array
    const fromSegmentPos = validIndices.indexOf(fromIndex);
    const toSegmentPos = validIndices.indexOf(toIndex);
    
    // Both segments must exist
    if (fromSegmentPos === -1 || toSegmentPos === -1) return;
    
    // Calculate Y position between the two segments
    const fromSegmentY = funnelTop + (fromSegmentPos * segmentHeight);
    const toSegmentY = funnelTop + (toSegmentPos * segmentHeight);
    const connectionY = (fromSegmentY + toSegmentY) / 2;
    
    // Calculate funnel width at the connection point (between segments)
    // Use the position between the two segments
    const midPosition = (fromSegmentPos + toSegmentPos) / 2;
    const positionRatio = totalSegments > 1 ? midPosition / (totalSegments - 1) : 0;
    const widthScale = 1 - (positionRatio * 0.75);
    const funnelWidth = maxWidth * widthScale;
    const funnelRightX = funnelCenterX + (funnelWidth / 2);
    
    // Draw activities on the right side of the funnel
    const activityStartX = funnelRightX + 25;
    const baseSpacing = 20;
    const maxActivityWidth = canvas.width - activityStartX - 20;
    
    // First pass: calculate all box heights
    ctx.font = 'bold 11px sans-serif';
    const boxPadding = 8;
    const lineHeight = 14;
    const maxTextWidth = maxActivityWidth - (boxPadding * 2);
    
    const boxHeights = activities.map(activity => {
      const words = activity.name.split(' ');
      let lines = [];
      let currentLine = '';
      
      words.forEach(word => {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        const metrics = ctx.measureText(testLine);
        if (metrics.width > maxTextWidth && currentLine) {
          lines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      });
      if (currentLine) {
        lines.push(currentLine);
      }
      
      return Math.max((lines.length * lineHeight) + (boxPadding * 2), 30); // Min height 30
    });
    
    // Calculate cumulative positions with dynamic spacing
    const activityPositions = [];
    let cumulativeY = 0;
    
    // Calculate total height including spacing between boxes
    let totalHeight = 0;
    boxHeights.forEach((height, idx) => {
      totalHeight += height;
      if (idx < boxHeights.length - 1) {
        totalHeight += 8; // Spacing between boxes
      }
    });
    
    // Start from top of the total height, centered around connectionY
    cumulativeY = connectionY - (totalHeight / 2);
    
    boxHeights.forEach((height, idx) => {
      activityPositions.push(cumulativeY + height / 2);
      cumulativeY += height;
      if (idx < boxHeights.length - 1) {
        cumulativeY += 8; // Spacing between boxes
      }
    });
    
    activities.forEach((activity, idx) => {
      const activityY = activityPositions[idx];
      
      // Draw arrow from activity to funnel
      ctx.strokeStyle = '#6b7280';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(activityStartX + 10, activityY);
      ctx.lineTo(funnelRightX + 2, connectionY);
      ctx.stroke();
      ctx.setLineDash([]);
      
      // Draw arrowhead
      const angle = Math.atan2(connectionY - activityY, (funnelRightX + 2) - (activityStartX + 10));
      const arrowLength = 8;
      const arrowAngle = Math.PI / 6;
      ctx.strokeStyle = '#6b7280';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(funnelRightX + 2, connectionY);
      ctx.lineTo(
        (funnelRightX + 2) - arrowLength * Math.cos(angle - arrowAngle),
        connectionY - arrowLength * Math.sin(angle - arrowAngle)
      );
      ctx.moveTo(funnelRightX + 2, connectionY);
      ctx.lineTo(
        (funnelRightX + 2) - arrowLength * Math.cos(angle + arrowAngle),
        connectionY - arrowLength * Math.sin(angle + arrowAngle)
      );
      ctx.stroke();
      
      // Draw activity label box
      const config = ACTIVITY_LAYER_CONFIG[layer];
      const labelColors = {
        gray: { bg: '#f3f4f6', border: '#9ca3af', text: '#374151' },
        blue: { bg: '#dbeafe', border: '#60a5fa', text: '#1e40af' },
        purple: { bg: '#f3e8ff', border: '#a78bfa', text: '#6b21a8' },
        orange: { bg: '#fed7aa', border: '#f59e0b', text: '#92400e' },
        green: { bg: '#d1fae5', border: '#34d399', text: '#065f46' }
      };
      const colors = labelColors[config.color] || labelColors.gray;
      
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      
      // Wrap text to multiple lines if needed (same calculation as above)
      const words = activity.name.split(' ');
      const lines = [];
      let currentLine = '';
      
      words.forEach(word => {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        const metrics = ctx.measureText(testLine);
        if (metrics.width > maxTextWidth && currentLine) {
          lines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      });
      if (currentLine) {
        lines.push(currentLine);
      }
      
      // Calculate box dimensions (should match boxHeights[idx])
      const boxWidth = Math.min(
        Math.max(...lines.map(line => ctx.measureText(line).width)) + (boxPadding * 2),
        maxActivityWidth
      );
      const boxHeight = boxHeights[idx]; // Use pre-calculated height
      const boxX = activityStartX;
      const boxY = activityY - boxHeight / 2;
      
      // Draw rounded rectangle
      ctx.fillStyle = colors.bg;
      ctx.strokeStyle = colors.border;
      ctx.lineWidth = 1.5;
      const radius = 5;
      ctx.beginPath();
      ctx.moveTo(boxX + radius, boxY);
      ctx.lineTo(boxX + boxWidth - radius, boxY);
      ctx.quadraticCurveTo(boxX + boxWidth, boxY, boxX + boxWidth, boxY + radius);
      ctx.lineTo(boxX + boxWidth, boxY + boxHeight - radius);
      ctx.quadraticCurveTo(boxX + boxWidth, boxY + boxHeight, boxX + boxWidth - radius, boxY + boxHeight);
      ctx.lineTo(boxX + radius, boxY + boxHeight);
      ctx.quadraticCurveTo(boxX, boxY + boxHeight, boxX, boxY + boxHeight - radius);
      ctx.lineTo(boxX, boxY + radius);
      ctx.quadraticCurveTo(boxX, boxY, boxX + radius, boxY);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      
      // Draw activity name (multi-line)
      ctx.fillStyle = colors.text;
      lines.forEach((line, lineIdx) => {
        ctx.fillText(line, boxX + boxPadding, boxY + boxPadding + (lineIdx * lineHeight));
      });
    });
  });
  
  // Draw activities for New Customers (at the last segment)
  const customerActivities = funnelData.activities.customerActivities || [];
  if (customerActivities.length > 0) {
    const customersIndex = validIndices.indexOf(4); // New Customers is index 4
    if (customersIndex !== -1) {
      // Calculate Y position at the center of the New Customers segment
      const segmentY = funnelTop + (customersIndex * segmentHeight);
      const nextSegmentY = funnelTop + ((customersIndex + 1) * segmentHeight);
      const connectionY = (segmentY + nextSegmentY) / 2;
      
      // Calculate funnel width at the last segment
      const positionRatio = totalSegments > 1 ? customersIndex / (totalSegments - 1) : 0;
      const widthScale = 1 - (positionRatio * 0.75);
      const funnelWidth = maxWidth * widthScale;
      const funnelRightX = funnelCenterX + (funnelWidth / 2);
      
      // Draw activities on the right side of the funnel
      const activityStartX = funnelRightX + 25;
      const baseSpacing = 20;
      const maxActivityWidth = canvas.width - activityStartX - 20;
      
      // First pass: calculate all box heights
      ctx.font = 'bold 11px sans-serif';
      const boxPadding = 8;
      const lineHeight = 14;
      const maxTextWidth = maxActivityWidth - (boxPadding * 2);
      
      const boxHeights = customerActivities.map(activity => {
        const words = activity.name.split(' ');
        let lines = [];
        let currentLine = '';
        
        words.forEach(word => {
          const testLine = currentLine ? `${currentLine} ${word}` : word;
          const metrics = ctx.measureText(testLine);
          if (metrics.width > maxTextWidth && currentLine) {
            lines.push(currentLine);
            currentLine = word;
          } else {
            currentLine = testLine;
          }
        });
        if (currentLine) {
          lines.push(currentLine);
        }
        
        return Math.max((lines.length * lineHeight) + (boxPadding * 2), 30); // Min height 30
      });
      
      // Calculate cumulative positions with dynamic spacing
      const activityPositions = [];
      let cumulativeY = 0;
      
      // Calculate total height including spacing between boxes
      let totalHeight = 0;
      boxHeights.forEach((height, idx) => {
        totalHeight += height;
        if (idx < boxHeights.length - 1) {
          totalHeight += 8; // Spacing between boxes
        }
      });
      
      // Start from top of the total height, centered around connectionY
      cumulativeY = connectionY - (totalHeight / 2);
      
      boxHeights.forEach((height, idx) => {
        activityPositions.push(cumulativeY + height / 2);
        cumulativeY += height;
        if (idx < boxHeights.length - 1) {
          cumulativeY += 8; // Spacing between boxes
        }
      });
      
      customerActivities.forEach((activity, idx) => {
        const activityY = activityPositions[idx];
        
        // Draw arrow from activity to funnel (pointing to the segment, not between segments)
        ctx.strokeStyle = '#6b7280';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(activityStartX + 10, activityY);
        ctx.lineTo(funnelRightX + 2, connectionY);
        ctx.stroke();
        ctx.setLineDash([]);
        
        // Draw arrowhead
        const angle = Math.atan2(connectionY - activityY, (funnelRightX + 2) - (activityStartX + 10));
        const arrowLength = 8;
        const arrowAngle = Math.PI / 6;
        ctx.strokeStyle = '#6b7280';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(funnelRightX + 2, connectionY);
        ctx.lineTo(
          (funnelRightX + 2) - arrowLength * Math.cos(angle - arrowAngle),
          connectionY - arrowLength * Math.sin(angle - arrowAngle)
        );
        ctx.moveTo(funnelRightX + 2, connectionY);
        ctx.lineTo(
          (funnelRightX + 2) - arrowLength * Math.cos(angle + arrowAngle),
          connectionY - arrowLength * Math.sin(angle + arrowAngle)
        );
        ctx.stroke();
        
        // Draw activity label box
        const config = ACTIVITY_LAYER_CONFIG.customerActivities;
        const labelColors = {
          gray: { bg: '#f3f4f6', border: '#9ca3af', text: '#374151' },
          blue: { bg: '#dbeafe', border: '#60a5fa', text: '#1e40af' },
          purple: { bg: '#f3e8ff', border: '#a78bfa', text: '#6b21a8' },
          orange: { bg: '#fed7aa', border: '#f59e0b', text: '#92400e' },
          green: { bg: '#d1fae5', border: '#34d399', text: '#065f46' }
        };
        const colors = labelColors[config.color] || labelColors.green;
        
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        
        // Wrap text to multiple lines if needed (same calculation as above)
        const words = activity.name.split(' ');
        const lines = [];
        let currentLine = '';
        
        words.forEach(word => {
          const testLine = currentLine ? `${currentLine} ${word}` : word;
          const metrics = ctx.measureText(testLine);
          if (metrics.width > maxTextWidth && currentLine) {
            lines.push(currentLine);
            currentLine = word;
          } else {
            currentLine = testLine;
          }
        });
        if (currentLine) {
          lines.push(currentLine);
        }
        
        // Calculate box dimensions (should match boxHeights[idx])
        const boxWidth = Math.min(
          Math.max(...lines.map(line => ctx.measureText(line).width)) + (boxPadding * 2),
          maxActivityWidth
        );
        const boxHeight = boxHeights[idx]; // Use pre-calculated height
        const boxX = activityStartX;
        const boxY = activityY - boxHeight / 2;
        
        // Draw rounded rectangle
        ctx.fillStyle = colors.bg;
        ctx.strokeStyle = colors.border;
        ctx.lineWidth = 1.5;
        const radius = 5;
        ctx.beginPath();
        ctx.moveTo(boxX + radius, boxY);
        ctx.lineTo(boxX + boxWidth - radius, boxY);
        ctx.quadraticCurveTo(boxX + boxWidth, boxY, boxX + boxWidth, boxY + radius);
        ctx.lineTo(boxX + boxWidth, boxY + boxHeight - radius);
        ctx.quadraticCurveTo(boxX + boxWidth, boxY + boxHeight, boxX + boxWidth - radius, boxY + boxHeight);
        ctx.lineTo(boxX + radius, boxY + boxHeight);
        ctx.quadraticCurveTo(boxX, boxY + boxHeight, boxX, boxY + boxHeight - radius);
        ctx.lineTo(boxX, boxY + radius);
        ctx.quadraticCurveTo(boxX, boxY, boxX + radius, boxY);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        
        // Draw activity name (multi-line)
        ctx.fillStyle = colors.text;
        lines.forEach((line, lineIdx) => {
          ctx.fillText(line, boxX + boxPadding, boxY + boxPadding + (lineIdx * lineHeight));
        });
      });
    }
  }
}

function renderNurtureFunnelChart(data) {
  const canvas = document.getElementById('nurtureFunnelChart');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const container = canvas.parentElement;
  if (container) {
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width || 300;
    canvas.height = 200;
  }
  const labels = ['Drop-offs captured', 'Reactivated (back to THINK)'];
  const values = [
    Math.max(0, data.nurtureCaptured || 0),
    Math.max(0, data.nurtureReturning || 0)
  ];

  const maxValue = Math.max(...values);
  if (maxValue <= 0) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#9ca3af';
    ctx.textAlign = 'center';
    ctx.fillText('Enable nurture funnel to see reactivation flow.', canvas.width / 2, 20);
    return;
  }

  const chartArea = {
    x: 40,
    y: 20,
    width: (canvas.width || 300) - 80,
    barHeight: 60,
    gap: 30
  };

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = 'left';
  ctx.font = '13px sans-serif';

  values.forEach((value, idx) => {
    const normalized = value / maxValue;
    const barWidth = chartArea.width * normalized;
    const startY = chartArea.y + idx * (chartArea.barHeight + chartArea.gap);
    const colors = ['rgba(251, 191, 36, 0.6)', 'rgba(125, 211, 252, 0.6)'];
    const borders = ['rgb(217, 119, 6)', 'rgb(14, 165, 233)'];

    ctx.fillStyle = colors[idx];
    ctx.strokeStyle = borders[idx];
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(chartArea.x, startY, Math.max(10, barWidth), chartArea.barHeight, 8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#1f2937';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText(labels[idx], chartArea.x + 8, startY + 22);
    ctx.font = '12px sans-serif';
    ctx.fillText(`${formatNumber(value)} people`, chartArea.x + 8, startY + 40);
  });
}

function formatNumber(value) {
  if (!isFinite(value)) return '0';
  return Math.round(value).toLocaleString('nl-NL');
}

function formatMonthShort(monthKey) {
  if (!monthKey) return '';
  const [year, month] = monthKey.split('-').map(Number);
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthIndex = Math.max(0, Math.min(11, (month || 1) - 1));
  return `${monthNames[monthIndex]} ${year}`;
}

function generateMonthKeys(count = MONTH_COUNT) {
  const keys = [];
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  for (let i = 0; i < count; i++) {
    const d = new Date(start);
    d.setMonth(start.getMonth() + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    keys.push(key);
  }
  return keys;
}

function buildMonthlyTimeline(baseFlow, conversions, data, months = MONTH_COUNT) {
  const timeline = [];
  const reentryLeads = new Array(months).fill(0);

  const dropSee = Math.max(0, baseFlow.reach - baseFlow.leads);
  const dropThink = Math.max(0, baseFlow.leads - baseFlow.oneOnOne);
  const dropDo = Math.max(0, baseFlow.oneOnOne - baseFlow.orders);
  const totalDrop = dropSee + dropThink + dropDo;

  const nurture = data.nurture || { enabled: false };
  const captureRate = (nurture.captureRate || 0) / 100;
  const conversionRate = (nurture.conversionRate || 0) / 100;
  const delay = Math.max(0, nurture.delayMonths || 0);

  for (let month = 0; month < months; month++) {
    const extraLeads = reentryLeads[month] || 0;

    const extraOneOnOneFromLeads = safeMultiply(extraLeads, conversions.leadsRate);
    const extraOrdersFromLeads = safeMultiply(extraOneOnOneFromLeads, conversions.conversationRate);
    const extraCustomersFromLeads = safeMultiply(extraOrdersFromLeads, conversions.orderRate);

    const totals = {
      reach: baseFlow.reach,
      leads: baseFlow.leads + extraLeads,
      oneOnOne: baseFlow.oneOnOne + extraOneOnOneFromLeads,
      orders: baseFlow.orders + extraOrdersFromLeads,
      customers: baseFlow.customers + extraCustomersFromLeads
    };

    const extras = {
      reach: 0,
      leads: extraLeads,
      oneOnOne: extraOneOnOneFromLeads,
      orders: extraOrdersFromLeads,
      customers: extraCustomersFromLeads
    };

    let nurtureStats = { captured: 0, converted: 0, delay };

    if (nurture.enabled && captureRate > 0 && conversionRate > 0 && totalDrop > 0) {
      const captured = totalDrop * captureRate;
      const converted = captured * conversionRate;
      nurtureStats = { captured, converted, delay };
      const targetIndex = month + delay;
      if (targetIndex < months) {
        reentryLeads[targetIndex] += converted;
      }
    }

    timeline.push({
      base: { ...baseFlow },
      extras,
      totals,
      nurture: nurtureStats
    });
  }

  return timeline;
}

function renderYearPlanner(monthKeys, timeline) {
  const body = document.getElementById('yearPlannerBody');
  if (!body) return;

  if (!timeline || timeline.length === 0) {
    body.innerHTML = `<tr class="border-b"><td colspan="7" class="py-4 px-3 text-center text-gray-400">Adjust your inputs to generate a yearly plan.</td></tr>`;
    return;
  }

  const rows = timeline.map((entry, index) => {
    const monthKey = monthKeys[index];
    const label = monthKey ? formatMonthShort(monthKey) : `Month ${index + 1}`;
    const totals = entry.totals;
    const extras = entry.extras;
    const nurtureCustomers = extras.customers || 0;

    return `
      <tr class="border-b hover:bg-gray-50">
        <td class="py-2 px-3">${label}</td>
        <td class="text-right py-2 px-3">${formatNumber(totals.reach)}</td>
        <td class="text-right py-2 px-3">${formatNumber(totals.leads)}</td>
        <td class="text-right py-2 px-3">${formatNumber(totals.oneOnOne)}</td>
        <td class="text-right py-2 px-3">${formatNumber(totals.orders)}</td>
        <td class="text-right py-2 px-3">${formatNumber(totals.customers)}</td>
        <td class="text-right py-2 px-3 text-emerald-600">${nurtureCustomers > 0 ? '+' + formatNumber(nurtureCustomers) : '-'}</td>
      </tr>
    `;
  }).join('');

  body.innerHTML = rows;
}

// Helper function to adjust color brightness
function adjustBrightness(color, percent) {
  // Extract RGB from rgba string
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (!match) return color;
  
  const r = Math.max(0, Math.min(255, parseInt(match[1]) + percent));
  const g = Math.max(0, Math.min(255, parseInt(match[2]) + percent));
  const b = Math.max(0, Math.min(255, parseInt(match[3]) + percent));
  const a = match[4] ? parseFloat(match[4]) : 1;
  
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function getFunnelColors() {
  return [
    'rgba(107, 114, 128, 0.7)',  // gray - reach
    'rgba(59, 130, 246, 0.7)',   // blue - leads
    'rgba(139, 92, 246, 0.7)',   // purple - conversations
    'rgba(245, 158, 11, 0.7)',   // orange - orders
    'rgba(34, 197, 94, 0.9)'     // green - new customers
  ];
}

function getFunnelBorderColors() {
  return [
    'rgb(107, 114, 128)',
    'rgb(59, 130, 246)',
    'rgb(139, 92, 246)',
    'rgb(245, 158, 11)',
    'rgb(34, 197, 94)'
  ];
}

// Save configuration
function saveFunnelConfig() {
  const config = {
    ...funnelData,
    timestamp: new Date().toISOString(),
    version: '4.0-reverse-simple'
  };
  
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `funnel-reverse-config-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

// Load configuration
function loadFunnelConfig(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const config = JSON.parse(e.target.result);
      
      if (config.startMode) funnelData.startMode = config.startMode;
      if (config.baseValue !== undefined) funnelData.baseValue = config.baseValue;
      else if (config.newCustomersPerMonth !== undefined) funnelData.baseValue = config.newCustomersPerMonth;
      else if (config.targetCustomers !== undefined) funnelData.baseValue = config.targetCustomers; // Legacy support
       if (config.churnRate !== undefined) funnelData.churnRate = config.churnRate;
       if (config.conversions) {
         funnelData.conversions = { ...funnelData.conversions, ...config.conversions };
       }
      if (config.nurture) {
        funnelData.nurture.enabled = !!config.nurture.enabled;
        funnelData.nurture.captureRate = parseFloat(config.nurture.captureRate) || 0;
        funnelData.nurture.conversionRate = parseFloat(config.nurture.conversionRate) || 0;
        funnelData.nurture.delayMonths = Math.max(0, parseInt(config.nurture.delayMonths ?? 0, 10) || 0);
      }
      if (config.activities) {
        funnelData.activities = { ...funnelData.activities, ...config.activities };
      }
       
       // Update UI
      const startModeSelect = document.getElementById('startMode');
      if (startModeSelect) startModeSelect.value = funnelData.startMode;
      const startValueInput = document.getElementById('startValueInput');
      if (startValueInput) startValueInput.value = funnelData.baseValue;
      const churnRateInput = document.getElementById('churnRate');
      if (churnRateInput) churnRateInput.value = funnelData.churnRate;
      const reachInput = document.getElementById('convReachToLeads');
      if (reachInput) reachInput.value = funnelData.conversions.reachToLeads;
      const leadsInput = document.getElementById('convLeadsToConversation');
      if (leadsInput) leadsInput.value = funnelData.conversions.leadsToConversation;
      const convoInput = document.getElementById('convConversationToOrder');
      if (convoInput) convoInput.value = funnelData.conversions.conversationToOrder;
      const orderInput = document.getElementById('convOrderToCustomer');
      if (orderInput) orderInput.value = funnelData.conversions.orderToCustomer;
      applyStartModeConfig({ preserveValue: true });
      applyNurtureUI({ setValues: true });
      renderActivities();
       
      calculateReverseFunnel();
      saveData();
      alert('Configuration loaded!');
    } catch (err) {
      alert('Error loading: ' + err.message);
    }
  };
  reader.readAsText(file);
}

// Save to localStorage
function saveData() {
  try {
    const mode = document.getElementById('startMode')?.value;
    if (mode) funnelData.startMode = mode;
    funnelData.baseValue = parseFloat(document.getElementById('startValueInput')?.value) || 0;
    const churnValue = parseFloat(document.getElementById('churnRate')?.value) || 0;
    funnelData.churnRate = START_MODE_CONFIG[funnelData.startMode]?.showChurn ? churnValue : 0;
    funnelData.conversions.reachToLeads = parseFloat(document.getElementById('convReachToLeads')?.value) || 0;
    funnelData.conversions.leadsToConversation = parseFloat(document.getElementById('convLeadsToConversation')?.value) || 0;
    funnelData.conversions.conversationToOrder = parseFloat(document.getElementById('convConversationToOrder')?.value) || 0;
    funnelData.conversions.orderToCustomer = parseFloat(document.getElementById('convOrderToCustomer')?.value) || 0;
    funnelData.nurture.enabled = !!document.getElementById('nurtureEnabled')?.checked;
    funnelData.nurture.captureRate = parseFloat(document.getElementById('nurtureCapture')?.value) || 0;
    funnelData.nurture.conversionRate = parseFloat(document.getElementById('nurtureConversion')?.value) || 0;
    funnelData.nurture.delayMonths = Math.max(0, parseInt(document.getElementById('nurtureDelay')?.value || '0', 10) || 0);
    
    // Activities are already stored in funnelData.activities (updated by addActivity/removeActivity)
     
    localStorage.setItem('funnelReverseData', JSON.stringify(funnelData));
  } catch (e) {
    console.error('Error saving data:', e);
  }
}

// Load from localStorage
function loadData() {
  try {
    const saved = localStorage.getItem('funnelReverseData');
    if (saved) {
      const data = JSON.parse(saved);
      if (data.startMode) funnelData.startMode = data.startMode;
      if (data.baseValue !== undefined) funnelData.baseValue = data.baseValue;
      else if (data.newCustomersPerMonth !== undefined) funnelData.baseValue = data.newCustomersPerMonth;
      else if (data.targetCustomers !== undefined) funnelData.baseValue = data.targetCustomers; // Legacy support
      if (data.churnRate !== undefined) funnelData.churnRate = data.churnRate;
      if (data.conversions) {
        funnelData.conversions = { ...funnelData.conversions, ...data.conversions };
      }
      if (data.nurture) {
        funnelData.nurture.enabled = !!data.nurture.enabled;
        funnelData.nurture.captureRate = parseFloat(data.nurture.captureRate) || 0;
        funnelData.nurture.conversionRate = parseFloat(data.nurture.conversionRate) || 0;
        funnelData.nurture.delayMonths = Math.max(0, parseInt(data.nurture.delayMonths ?? 0, 10) || 0);
      }
      if (data.activities) {
        funnelData.activities = { ...funnelData.activities, ...data.activities };
      }
       
      // Update UI
      const startModeSelect = document.getElementById('startMode');
      if (startModeSelect) startModeSelect.value = funnelData.startMode;
      const startValueInput = document.getElementById('startValueInput');
      if (startValueInput) startValueInput.value = funnelData.baseValue;
      const churnRateInput = document.getElementById('churnRate');
      if (churnRateInput) churnRateInput.value = funnelData.churnRate;
      const reachInput = document.getElementById('convReachToLeads');
      if (reachInput) reachInput.value = funnelData.conversions.reachToLeads;
      const leadsInput = document.getElementById('convLeadsToConversation');
      if (leadsInput) leadsInput.value = funnelData.conversions.leadsToConversation;
      const convoInput = document.getElementById('convConversationToOrder');
      if (convoInput) convoInput.value = funnelData.conversions.conversationToOrder;
      const orderInput = document.getElementById('convOrderToCustomer');
      if (orderInput) orderInput.value = funnelData.conversions.orderToCustomer;
      applyStartModeConfig({ preserveValue: true });
      applyNurtureUI({ setValues: true });
      renderActivities();
    }
  } catch (e) {
    console.error('Error loading data:', e);
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadData();

  applyStartModeConfig({ preserveValue: false });
  applyNurtureUI({ setValues: true });
  renderActivities();
   
  // Input listeners voor automatische berekening
  const inputs = [
    'startValueInput',
    'churnRate',
    'convReachToLeads',
    'convLeadsToConversation',
    'convConversationToOrder',
    'convOrderToCustomer'
  ];
  
  inputs.forEach(id => {
    const input = document.getElementById(id);
    if (input) {
      input.addEventListener('input', calculateReverseFunnel);
    }
  });
  
  // Save/Load
  document.getElementById('saveConfigBtn')?.addEventListener('click', saveFunnelConfig);
  document.getElementById('loadConfigBtn')?.addEventListener('click', () => {
    document.getElementById('loadConfigInput').click();
  });
  document.getElementById('loadConfigInput')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) loadFunnelConfig(file);
    e.target.value = '';
  });
  
  const showConversionsToggle = document.getElementById('showConversionsToggle');
  if (showConversionsToggle) {
    showConversionRates = showConversionsToggle.checked;
    showConversionsToggle.addEventListener('change', (e) => {
      showConversionRates = e.target.checked;
      if (currentFunnelData) {
        renderFunnelChart(currentFunnelData);
      }
    });
  }

  const primaryToggle = document.getElementById('showPrimaryFunnelToggle');
  if (primaryToggle) {
    primaryToggle.addEventListener('change', (e) => {
      const wrapper = document.getElementById('primaryFunnelWrapper');
      if (wrapper) wrapper.classList.toggle('hidden', !e.target.checked);
      if (e.target.checked && currentFunnelData) {
        renderFunnelChart(currentFunnelData);
      }
    });
  }

  const nurtureToggle = document.getElementById('showNurtureFunnelToggle');
  if (nurtureToggle) {
    nurtureToggle.addEventListener('change', (e) => {
      const wrapper = document.getElementById('nurtureFunnelWrapper');
      if (wrapper) wrapper.classList.toggle('hidden', !e.target.checked);
      if (e.target.checked && currentFunnelData) {
        renderNurtureFunnelChart(currentFunnelData);
      }
    });
  }
 
  const startModeSelect = document.getElementById('startMode');
  if (startModeSelect) {
    startModeSelect.addEventListener('change', (e) => {
      funnelData.startMode = e.target.value;
      const config = START_MODE_CONFIG[funnelData.startMode] || START_MODE_CONFIG.customers;
      const startValueInputEl = document.getElementById('startValueInput');
      if (startValueInputEl) {
        let currentVal = parseFloat(startValueInputEl.value);
        if (!isFinite(currentVal) || currentVal <= 0) {
          currentVal = config.defaultValue || 0;
          startValueInputEl.value = currentVal;
        }
        funnelData.baseValue = currentVal;
      }
      applyStartModeConfig({ preserveValue: true });
      calculateReverseFunnel();
    });
  }

  const nurtureEnabledToggle = document.getElementById('nurtureEnabled');
  if (nurtureEnabledToggle) {
    nurtureEnabledToggle.addEventListener('change', () => {
      updateNurtureFromInputs();
      calculateReverseFunnel();
    });
  }

  const nurtureInputs = [
    'nurtureCapture',
    'nurtureConversion',
    'nurtureDelay'
  ];
  nurtureInputs.forEach((id) => {
    const input = document.getElementById(id);
    if (input) {
      const handler = id.endsWith('Delay') ? 'change' : 'input';
      input.addEventListener(handler, () => {
        updateNurtureFromInputs();
        calculateReverseFunnel();
      });
    }
  });

  // Initial calculation
  calculateReverseFunnel();
  
  // Redraw funnel on window resize
  let resizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      if (currentFunnelData) {
        renderFunnelChart(currentFunnelData);
      }
    }, 250);
  });
});
