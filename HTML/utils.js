/* utils.js */
export const groupBy = (arr, key) => {
    const map = new Map();
    arr.forEach(item => {
      const k = item[key];
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(item);
    });
    return [...map];
  };
  
  export const sumBy = (arr, fn) =>
    arr.reduce((sum, item) => sum + fn(item), 0);
  