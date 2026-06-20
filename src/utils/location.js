/**
 * Utility to parse country names from location strings.
 */

const countryMap = {
  // Abbreviations & common variants
  'bd': 'Bangladesh',
  'bangladesh': 'Bangladesh',
  'us': 'United States',
  'usa': 'United States',
  'united states': 'United States',
  'united states of america': 'United States',
  'uk': 'United Kingdom',
  'gb': 'United Kingdom',
  'united kingdom': 'United Kingdom',
  'de': 'Germany',
  'germany': 'Germany',
  'nl': 'Netherlands',
  'netherlands': 'Netherlands',
  'vn': 'Vietnam',
  'vietnam': 'Vietnam',
  'au': 'Australia',
  'australia': 'Australia',
  'ca': 'Canada',
  'canada': 'Canada',
  'kr': 'Korea',
  'korea': 'Korea',
  'korea, republic of': 'Korea',
  'in': 'India',
  'india': 'India',
  'es': 'Spain',
  'spain': 'Spain',
  'be': 'Belgium',
  'belgium': 'Belgium',
  'cy': 'Cyprus',
  'cyprus': 'Cyprus',
  'my': 'Malaysia',
  'malaysia': 'Malaysia',
  'ae': 'United Arab Emirates',
  'uae': 'United Arab Emirates',
  'united arab emirates': 'United Arab Emirates',
  'br': 'Brazil',
  'brazil': 'Brazil',
  'sg': 'Singapore',
  'singapore': 'Singapore',
  'rs': 'Serbia',
  'serbia': 'Serbia',
  'pe': 'Peru',
  'peru': 'Peru',
  'co': 'Colombia',
  'colombia': 'Colombia',
  've': 'Venezuela',
  'venezuela': 'Venezuela',
  'jp': 'Japan',
  'japan': 'Japan',
  
  // US State abbreviations (to map to United States)
  'al': 'United States', 'ak': 'United States', 'az': 'United States', 'ar': 'United States',
  'co': 'United States', 'ct': 'United States', 'de': 'United States', 'fl': 'United States', 'ga': 'United States',
  'hi': 'United States', 'id': 'United States', 'il': 'United States', 'in': 'United States', 'ia': 'United States',
  'ks': 'United States', 'ky': 'United States', 'la': 'United States', 'me': 'United States', 'md': 'United States',
  'ma': 'United States', 'mi': 'United States', 'mn': 'United States', 'ms': 'United States', 'mo': 'United States',
  'mt': 'United States', 'ne': 'United States', 'nv': 'United States', 'nh': 'United States', 'nj': 'United States',
  'nm': 'United States', 'ny': 'United States', 'nc': 'United States', 'nd': 'United States', 'oh': 'United States',
  'ok': 'United States', 'or': 'United States', 'pa': 'United States', 'ri': 'United States', 'sc': 'United States',
  'sd': 'United States', 'tn': 'United States', 'tx': 'United States', 'ut': 'United States', 'vt': 'United States',
  'va': 'United States', 'wa': 'United States', 'wv': 'United States', 'wi': 'United States', 'wy': 'United States'
};

const cityToCountry = {
  'dhaka': 'Bangladesh',
  'gulshan': 'Bangladesh',
  'rajshahi': 'Bangladesh',
  'sydney': 'Australia',
  'melbourne': 'Australia',
  'berlin': 'Germany',
  'munich': 'Germany',
  'frankfurt': 'Germany',
  'leipzig': 'Germany',
  'london': 'United Kingdom',
  'bournemouth': 'United Kingdom',
  'amsterdam': 'Netherlands',
  'seoul': 'Korea',
  'new york': 'United States',
  'austin': 'United States',
  'minneapolis': 'United States',
  'las vegas': 'United States',
  'hanoi': 'Vietnam',
  'singapore': 'Singapore',
  'tokyo': 'Japan',
  'minato': 'Japan',
  'belgrade': 'Serbia',
  'sao paulo': 'Brazil',
  'madrid': 'Spain',
  'zaventem': 'Belgium',
  'limassol': 'Cyprus',
  'kuala lumpur': 'Malaysia',
  'dubai': 'United Arab Emirates',
  'caracas': 'Venezuela',
  'bogota': 'Colombia',
  'san isidro': 'Peru',
  'bengaluru': 'India',
  'bangalore': 'India'
};

export function getCountryFromLocation(location) {
  if (!location) return 'Remote';
  
  const norm = location.trim().toLowerCase();
  
  // If location indicates Remote/Hybrid without a specific country context
  if (norm === 'remote' || norm === 'hybrid' || norm === 'remote or hybrid' || norm === 'anywhere') {
    return 'Remote';
  }
  
  // Split by common delimiters (semicolon, comma, slash)
  const segments = norm.split(/[;,/]+/).map(s => s.trim()).filter(Boolean);
  
  // Start from the last segment and check countryMap
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    
    // Exact mapping or abbreviation
    if (countryMap[seg]) {
      return countryMap[seg];
    }
    
    // Check if the segment ends or starts with a country word
    for (const key of Object.keys(countryMap)) {
      if (seg.includes(key)) {
        // Avoid partial word matching like "us" in "status"
        const regex = new RegExp(`\\b${key}\\b`, 'i');
        if (regex.test(seg)) {
          return countryMap[key];
        }
      }
    }
    
    // Check city mapping
    if (cityToCountry[seg]) {
      return cityToCountry[seg];
    }
    for (const key of Object.keys(cityToCountry)) {
      const regex = new RegExp(`\\b${key}\\b`, 'i');
      if (regex.test(seg)) {
        return cityToCountry[key];
      }
    }
  }
  
  // Fallback: Check if any part of the raw normalized location string matches
  for (const key of Object.keys(countryMap)) {
    const regex = new RegExp(`\\b${key}\\b`, 'i');
    if (regex.test(norm)) {
      return countryMap[key];
    }
  }
  for (const key of Object.keys(cityToCountry)) {
    const regex = new RegExp(`\\b${key}\\b`, 'i');
    if (regex.test(norm)) {
      return cityToCountry[key];
    }
  }
  
  // Capitalize the first letter of each segment as a fallback
  if (segments.length > 0) {
    const lastSeg = segments[segments.length - 1];
    return lastSeg.charAt(0).toUpperCase() + lastSeg.slice(1);
  }
  
  return 'Remote';
}
