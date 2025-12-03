/* state.js
   Centrale store + eenvoudige helper-functie
   ========================================= */

   export const state = {
    /* DATA */
    rawRows:      [],   // historisch csv
    actualRows:   [],   // tweede csv
    supplier:     '__all',
  
    /* EVENT-KLANTEN PER SUPPLIER */
    eventCustomersMap: new Map(),   // supplier → Set()
    eventGrowth:       new Map(),   // klant → groei %
  
    /* KPI’s */
    kpis: {
      churn:     5,
      newBiz:    5,
      growth:    5,
      dipDec:    5,
      dipBouwvak:5,
    },
  
    /* EXTRA MERKEN */
    extraBrands: [],                // {name, newCust, avgRev}
  
    /* FORECAST (wordt door forecast.js gevuld) */
    forecast: {
      labels:    [],
      normal:    [],
      event:     [],
      customers: [],
    },
  };
  
  /* Klein convenience-hulpje */
  export function update(fn) {
    fn(state);          // pas iets aan…
    if (typeof window !== 'undefined') {   // laat subscribers wissen
      window.dispatchEvent(new CustomEvent('statechange', { detail: state }));
    }
  }
  