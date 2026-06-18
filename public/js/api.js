/**
 * Frontend client for communicating with the backend REST API.
 */

async function request(url, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  const config = {
    ...options,
    headers,
  };

  if (config.body && typeof config.body === 'object') {
    config.body = JSON.stringify(config.body);
  }

  const response = await fetch(url, config);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `HTTP error! status: ${response.status}`);
  }

  return data;
}

export const api = {
  // Companies API
  getCompanies: () => request('/api/companies'),
  
  addCompany: (career_url, name) => request('/api/companies', {
    method: 'POST',
    body: { career_url, name }
  }),
  
  updateCompany: (id, data) => request(`/api/companies/${id}`, {
    method: 'PUT',
    body: data
  }),
  
  deleteCompany: (id) => request(`/api/companies/${id}`, {
    method: 'DELETE'
  }),
  
  scrapeCompany: (id) => request(`/api/companies/${id}/scrape`, {
    method: 'POST'
  }),

  // Jobs API
  getJobs: (filters = {}) => {
    const params = new URLSearchParams();
    if (filters.keyword) params.append('keyword', filters.keyword);
    if (filters.titleKeyword) params.append('titleKeyword', filters.titleKeyword);
    if (filters.companyId) params.append('companyId', filters.companyId);
    if (filters.status) params.append('status', filters.status);
    if (filters.jobType) params.append('jobType', filters.jobType);
    if (filters.page) params.append('page', filters.page);
    if (filters.limit) params.append('limit', filters.limit);
    
    return request(`/api/jobs?${params.toString()}`);
  },
  
  getStats: () => request('/api/jobs/stats'),
  
  deleteJob: (id) => request(`/api/jobs/${id}`, {
    method: 'DELETE'
  }),

  // Scheduler API
  getScheduler: () => request('/api/scheduler'),
  
  updateScheduler: (interval_hours, is_running) => request('/api/scheduler', {
    method: 'PUT',
    body: { interval_hours, is_running }
  }),
  
  scrapeAll: () => request('/api/scheduler/scrape-all', {
    method: 'POST'
  })
};
