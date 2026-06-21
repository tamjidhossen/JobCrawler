import { api } from './api.js';

// State Management
const state = {
  jobs: [],
  companies: [],
  stats: {},
  scheduler: {},
  filters: {
    keyword: '',
    titleKeyword: '',
    excludeTitleKeyword: '',
    locations: '',
    status: 'new', // Default filter to 'new' postings as requested by flow
    jobType: '',
    techOnly: '',
    firstSeen: '',
    page: 1,
    limit: 25
  },
  pagination: {
    total: 0,
    page: 1,
    limit: 25,
    pages: 1
  },
  selectedJob: null,
  searchDebounceTimer: null,
  logs: []
};

// DOM Elements
const els = {
  // Stats
  statTotalJobs: document.getElementById('stat-total-jobs'),
  statNewJobs: document.getElementById('stat-new-jobs'),
  statRemovedJobs: document.getElementById('stat-removed-jobs'),
  statCompanies: document.getElementById('stat-companies'),

  // Scheduler Quick Info
  schedStatusDot: document.getElementById('sched-status-dot'),
  schedStatusText: document.getElementById('sched-status-text'),
  btnPauseResume: document.getElementById('btn-pause-resume'),
  btnScrapeAll: document.getElementById('btn-scrape-all'),

  // Search & Filters
  searchInput: document.getElementById('search-input'),
  filterTitleKeyword: document.getElementById('filter-title-keyword'),
  excludeTitleKeyword: document.getElementById('exclude-title-keyword'),
  filterLocation: document.getElementById('filter-location'),
  filterStatus: document.getElementById('filter-status'),
  filterType: document.getElementById('filter-type'),
  filterTechOnly: document.getElementById('filter-tech-only'),
  filterFirstSeen: document.getElementById('filter-first-seen'),
  btnClearFilters: document.getElementById('btn-clear-filters'),

  // Lists Containers
  jobsListContainer: document.getElementById('jobs-list-container'),
  companiesListContainer: document.getElementById('companies-list-container'),
  jobsCountSummary: document.getElementById('jobs-count-summary'),

  // Pagination
  paginationContainer: document.getElementById('pagination-container'),
  btnPrevPage: document.getElementById('btn-prev-page'),
  btnNextPage: document.getElementById('btn-next-page'),
  paginationInfo: document.getElementById('pagination-info'),

  // Add Company Form
  addCompanyForm: document.getElementById('add-company-form'),
  companyUrlInput: document.getElementById('company-url'),
  companyNameInput: document.getElementById('company-name'),
  btnAddCompany: document.getElementById('btn-add-company'),

  // Scheduler Settings Card
  schedIntervalSelect: document.getElementById('sched-interval'),
  schedLastRunText: document.getElementById('sched-last-run'),
  schedNextRunText: document.getElementById('sched-next-run'),

  // Modal
  jobModal: document.getElementById('job-modal'),
  modalClose: document.getElementById('modal-close'),
  modalJobTitle: document.getElementById('modal-job-title'),
  modalJobCompany: document.getElementById('modal-job-company'),
  modalJobLocation: document.getElementById('modal-job-location'),
  modalJobDepartment: document.getElementById('modal-job-department'),
  modalJobType: document.getElementById('modal-job-type'),
  modalSalaryWrapper: document.getElementById('modal-salary-wrapper'),
  modalJobSalary: document.getElementById('modal-job-salary'),
  modalJobStatus: document.getElementById('modal-job-status'),
  modalJobDescription: document.getElementById('modal-job-description'),
  btnApplyJob: document.getElementById('btn-apply-job'),
  btnDeleteJob: document.getElementById('btn-delete-job'),

  // Edit Company Modal
  companyModal: document.getElementById('company-modal'),
  companyModalClose: document.getElementById('company-modal-close'),
  editCompanyForm: document.getElementById('edit-company-form'),
  editCompanyId: document.getElementById('edit-company-id'),
  editCompanyName: document.getElementById('edit-company-name'),
  editCompanyUrl: document.getElementById('edit-company-url'),
  editCompanyStatus: document.getElementById('edit-company-status'),
  btnCancelEditCompany: document.getElementById('btn-cancel-edit-company'),

  // Telegram Broadcast Modal
  btnTelegramPreview: document.getElementById('btn-telegram-preview'),
  telegramModal: document.getElementById('telegram-modal'),
  telegramModalClose: document.getElementById('telegram-modal-close'),
  telegramMessageText: document.getElementById('telegram-message-text'),
  telegramCharWarning: document.getElementById('telegram-char-warning'),
  btnCancelTelegram: document.getElementById('btn-cancel-telegram'),
  btnSendTelegram: document.getElementById('btn-send-telegram'),

  // WhatsApp Broadcast Modal
  btnWhatsappPreview: document.getElementById('btn-whatsapp-preview'),
  whatsappModal: document.getElementById('whatsapp-modal'),
  whatsappModalClose: document.getElementById('whatsapp-modal-close'),
  whatsappMessageText: document.getElementById('whatsapp-message-text'),
  btnCancelWhatsapp: document.getElementById('btn-cancel-whatsapp'),
  btnCopyWhatsapp: document.getElementById('btn-copy-whatsapp'),

  // Toast Container
  toastContainer: document.getElementById('toast-container'),

  // Logs
  logsContainer: document.getElementById('logs-container'),
  btnRefreshLogs: document.getElementById('btn-refresh-logs')
};

// ==========================================
// TOAST NOTIFICATIONS
// ==========================================
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerText = message;
  els.toastContainer.appendChild(toast);

  // Automatically remove toast after 4s
  setTimeout(() => {
    toast.style.animation = 'toastEnter 0.2s cubic-bezier(0.16, 1, 0.3, 1) reverse forwards';
    setTimeout(() => toast.remove(), 200);
  }, 4000);
}

// ==========================================
// DATE FORMATTING HELPERS
// ==========================================
function formatRelativeTime(dateString) {
  if (!dateString) return 'Never';
  
  let formattedString = dateString.replace(' ', 'T');
  // SQLite timestamps are in UTC. If the string lacks a timezone specifier, append 'Z' to parse it as UTC.
  if (!formattedString.endsWith('Z') && !/[+-]\d{2}:\d{2}$/.test(formattedString)) {
    formattedString += 'Z';
  }
  
  const date = new Date(formattedString);
  const now = new Date();
  const diffMs = now - date;
  
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

// ==========================================
// DATA LOADING
// ==========================================

async function loadSchedulerStatus() {
  try {
    const data = await api.getScheduler();
    state.scheduler = data;

    // Update Status Indicators
    els.schedStatusDot.className = 'status-dot';
    if (data.is_scraping) {
      els.schedStatusDot.classList.add('scraping');
      els.schedStatusText.innerText = 'Scraping career pages...';
      els.btnScrapeAll.disabled = true;
      els.btnScrapeAll.innerText = 'Scraping...';
    } else if (data.is_running) {
      els.schedStatusDot.classList.add('active');
      els.schedStatusText.innerText = 'Scheduler running';
      els.btnPauseResume.innerText = 'Pause';
      els.btnPauseResume.disabled = false;
      els.btnScrapeAll.disabled = false;
      els.btnScrapeAll.innerText = 'Scrape All';
    } else {
      els.schedStatusDot.classList.add('paused');
      els.schedStatusText.innerText = 'Scheduler paused';
      els.btnPauseResume.innerText = 'Resume';
      els.btnPauseResume.disabled = false;
      els.btnScrapeAll.disabled = false;
      els.btnScrapeAll.innerText = 'Scrape All';
    }

    // Update config card
    els.schedIntervalSelect.value = String(data.interval_hours);
    els.schedLastRunText.innerText = formatRelativeTime(data.last_run_at);
    els.schedNextRunText.innerText = data.is_running ? formatRelativeTime(data.next_run_at) : 'Paused';
  } catch (err) {
    loggerError('Error loading scheduler config', err);
  }
}

async function loadLogs() {
  if (!els.logsContainer) return;
  try {
    const logs = await api.getSchedulerLogs(20);
    state.logs = logs;
    renderLogsList();
  } catch (err) {
    loggerError('Error loading logs', err);
    els.logsContainer.innerHTML = '<div class="text-danger p-3 text-center">Failed to load logs.</div>';
  }
}

function renderLogsList() {
  const container = els.logsContainer;
  if (!container) return;
  container.innerHTML = '';

  if (state.logs.length === 0) {
    container.innerHTML = '<div class="empty-state">No scrape logs available.</div>';
    return;
  }

  state.logs.forEach(log => {
    const item = document.createElement('div');
    item.className = 'border-b border-claude-border last:border-b-0 pb-3 last:pb-0 flex flex-col gap-1';
    
    const timeText = log.created_at ? formatRelativeTime(log.created_at) : 'unknown';
    const statusText = log.status === 'success' ? 'Success' : 'Failed';
    const statusClass = log.status === 'success' ? 'text-success' : 'text-danger';

    item.innerHTML = `
      <div class="flex justify-between items-start">
        <span class="font-semibold text-claude-text">${log.company_name}</span>
        <span class="text-[10px] text-claude-muted">${timeText}</span>
      </div>
      <div class="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-claude-muted">
        <div>Status: <span class="font-medium ${statusClass}">${statusText}</span></div>
        <div>Duration: <span class="text-claude-text font-medium">${(log.duration_ms / 1000).toFixed(1)}s</span></div>
        <div>Gemini Calls: <span class="text-claude-text font-medium">${log.gemini_calls || 0}</span></div>
        <div>Jobs Found: <span class="text-claude-text font-medium">${log.jobs_found || 0}</span></div>
        <div>New Jobs: <span class="text-success font-medium">+${log.new_jobs || 0}</span></div>
        <div>Removed: <span class="text-danger font-medium">-${log.removed_jobs || 0}</span></div>
      </div>
      ${log.status === 'error' ? `
        <div class="text-[10px] text-danger mt-1 bg-red-950/20 px-2 py-0.5 rounded border border-red-900/30 truncate" title="${log.error_message}">
          Err: ${log.error_message}
        </div>
      ` : ''}
    `;
    container.appendChild(item);
  });
}

async function loadStats() {
  try {
    const stats = await api.getStats();
    state.stats = stats;

    els.statTotalJobs.innerText = stats.active_count || 0;
    els.statNewJobs.innerText = stats.new_count || 0;
    els.statRemovedJobs.innerText = stats.removed_count || 0;
    els.statCompanies.innerText = stats.company_count || 0;
  } catch (err) {
    loggerError('Error loading stats', err);
  }
}

async function loadCompanies() {
  try {
    const companies = await api.getCompanies();
    state.companies = companies;

    // Populate Side Column Companies List
    renderCompaniesList();
  } catch (err) {
    loggerError('Error loading companies', err);
  }
}

async function loadLocations() {
  try {
    const locations = await api.getLocations();
    
    // Save current selection to restore
    const selectedLocations = Array.from(els.filterLocation.options)
      .filter(o => o.selected && o.value)
      .map(o => o.value);

    els.filterLocation.innerHTML = '<option value="">All Locations</option>';
    locations.forEach(loc => {
      const option = document.createElement('option');
      option.value = loc;
      option.innerText = loc;
      els.filterLocation.appendChild(option);
    });

    // Restore selection from DOM or from state
    const saved = selectedLocations.length > 0 ? selectedLocations : (state.filters.locations || '').split(';').filter(Boolean);
    if (saved.length > 0) {
      Array.from(els.filterLocation.options).forEach(o => {
        o.selected = saved.includes(o.value);
      });
      // trigger selectEl change manually to update the UI trigger text
      els.filterLocation.dispatchEvent(new Event('change', { bubbles: true }));
    }
  } catch (err) {
    loggerError('Error loading locations', err);
  }
}

async function loadJobs() {
  els.jobsListContainer.innerHTML = `
    <div class="loading-state">
      <div class="spinner"></div>
      <p>Fetching jobs...</p>
    </div>
  `;

  try {
    const data = await api.getJobs(state.filters);
    state.jobs = data.jobs;
    state.pagination = data.pagination;

    renderJobsList();
    updatePaginationUI();
  } catch (err) {
    loggerError('Error loading jobs', err);
    els.jobsListContainer.innerHTML = `
      <div class="loading-state">
        <p class="text-danger">Failed to fetch job postings.</p>
      </div>
    `;
  }
}

// ==========================================
// LIST RENDERING
// ==========================================

function renderCompaniesList() {
  const container = els.companiesListContainer;
  container.innerHTML = '';

  if (state.companies.length === 0) {
    container.innerHTML = '<div class="empty-state">No companies tracked yet.</div>';
    return;
  }

  state.companies.forEach(company => {
    const item = document.createElement('div');
    item.className = 'company-item';
    
    let statusClass = 'active';
    let statusTitle = 'Healthy';
    if (company.status === 'error') {
      statusClass = 'error';
      statusTitle = company.last_error || 'Unknown Scraper Error';
    }

    let hostname = 'No Link';
    if (company.career_url && company.career_url.startsWith('http')) {
      try {
        hostname = new URL(company.career_url).hostname;
      } catch (e) {
        hostname = company.career_url;
      }
    } else if (company.career_url) {
      hostname = company.career_url;
    }

    item.innerHTML = `
      <div class="company-name-section" title="${statusTitle}">
        <span class="company-name">${company.name}</span>
        <span class="company-url">${company.career_url || 'No Link'}</span>
      </div>
      <div class="company-controls">
        <span class="company-status-indicator ${statusClass}" title="${statusTitle}"></span>
        <button class="btn btn-secondary btn-sm btn-scrape-company" data-id="${company.id}" title="Scrape career page now">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
        </button>
        <button class="btn btn-secondary btn-sm btn-edit-company" data-id="${company.id}" title="Edit company details">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4Z"/></svg>
        </button>
        <button class="btn btn-secondary btn-sm btn-delete-company text-danger" data-id="${company.id}" title="Delete company & jobs">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2M10 11v6M14 11v6"/></svg>
        </button>
      </div>
    `;

    // Bind item buttons
    item.querySelector('.btn-scrape-company').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      showToast(`Triggered scraping for ${company.name}`, 'info');
      try {
        await api.scrapeCompany(company.id);
        await refreshAllData();
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        btn.disabled = false;
      }
    });

    item.querySelector('.btn-edit-company').addEventListener('click', () => {
      els.editCompanyId.value = company.id;
      els.editCompanyName.value = company.name;
      els.editCompanyUrl.value = company.career_url;
      els.editCompanyStatus.value = company.status;
      els.companyModal.style.display = 'flex';
    });

    item.querySelector('.btn-delete-company').addEventListener('click', async () => {
      if (confirm(`Are you sure you want to stop tracking "${company.name}" and delete all its jobs?`)) {
        try {
          await api.deleteCompany(company.id);
          showToast(`Deleted ${company.name}`, 'success');
          await refreshAllData();
        } catch (err) {
          showToast(err.message, 'error');
        }
      }
    });

    container.appendChild(item);
  });
}

function renderJobsList() {
  const container = els.jobsListContainer;
  container.innerHTML = '';

  if (state.jobs.length === 0) {
    container.innerHTML = '<div class="empty-state">No jobs found matching the selected filters.</div>';
    els.jobsCountSummary.innerText = 'Showing 0 jobs';
    return;
  }

  // Update summary header
  const start = (state.pagination.page - 1) * state.pagination.limit + 1;
  const end = Math.min(start + state.jobs.length - 1, state.pagination.total);
  els.jobsCountSummary.innerText = `Showing ${start}-${end} of ${state.pagination.total} postings`;

  state.jobs.forEach(job => {
    const item = document.createElement('div');
    item.className = 'job-item';
    
    // Status Badge mapping
    let badgeHtml = '';
    if (job.status === 'new') {
      badgeHtml = '<span class="badge badge-new">NEW</span>';
    } else if (job.status === 'removed') {
      badgeHtml = '<span class="badge badge-removed">GONE</span>';
    } else {
      badgeHtml = '<span class="badge badge-active">Active</span>';
    }

    // Bullet strings
    const metaList = [];
    if (job.location) metaList.push(`<span>${job.location}</span>`);
    if (job.job_type) metaList.push(`<span class="bullet">${job.job_type}</span>`);
    if (job.salary_range) metaList.push(`<span class="bullet">${job.salary_range}</span>`);
    if (job.department) metaList.push(`<span class="bullet">${job.department}</span>`);
    
    const timeText = job.status === 'removed' 
      ? `Removed: ${formatRelativeTime(job.removed_at)}`
      : `First seen: ${formatRelativeTime(job.first_seen_at)}`;

    item.innerHTML = `
      <div class="job-info">
        <div class="job-title-row">
          <a href="#" class="job-title" data-id="${job.id}">${job.title}</a>
          ${badgeHtml}
        </div>
        <div class="job-meta">
          <strong>${job.company_name}</strong>
          ${metaList.join('')}
          <span class="bullet">${timeText}</span>
        </div>
        <p class="job-snippet">${job.description || 'No description extracted. Click for details.'}</p>
      </div>
      <div class="job-actions">
        <button class="btn btn-secondary btn-sm btn-view-job" data-id="${job.id}">View Details</button>
      </div>
    `;

    // Bind event listeners
    const openModalFn = (e) => {
      e.preventDefault();
      openJobModal(job);
    };

    item.querySelector('.job-title').addEventListener('click', openModalFn);
    item.querySelector('.btn-view-job').addEventListener('click', openModalFn);

    container.appendChild(item);
  });
}

function updatePaginationUI() {
  const pag = state.pagination;
  if (pag.pages <= 1) {
    els.paginationContainer.style.display = 'none';
    return;
  }

  els.paginationContainer.style.display = 'flex';
  els.paginationInfo.innerText = `Page ${pag.page} of ${pag.pages}`;
  els.btnPrevPage.disabled = pag.page <= 1;
  els.btnNextPage.disabled = pag.page >= pag.pages;
}

// ==========================================
// MODAL OPERATION
// ==========================================

function openJobModal(job) {
  state.selectedJob = job;

  els.modalJobTitle.innerText = job.title;
  els.modalJobCompany.innerText = job.company_name;
  els.modalJobLocation.innerText = job.location || 'Not specified';
  els.modalJobDepartment.innerText = job.department || 'Not specified';
  els.modalJobType.innerText = job.job_type || 'Not specified';
  
  if (job.salary_range) {
    els.modalSalaryWrapper.style.display = 'flex';
    els.modalJobSalary.innerText = job.salary_range;
  } else {
    els.modalSalaryWrapper.style.display = 'none';
  }

  // Status mapping
  els.modalJobStatus.innerHTML = job.status === 'new' 
    ? '<span class="badge badge-new">New Posting</span>'
    : job.status === 'removed' 
      ? '<span class="badge badge-removed">Removed (Old Post)</span>'
      : '<span class="badge badge-active">Active</span>';

  els.modalJobDescription.innerText = job.description || 'No description details available.';
  
  // Setup apply link
  if (job.job_url) {
    els.btnApplyJob.href = job.job_url;
    els.btnApplyJob.style.display = 'inline-flex';
  } else {
    els.btnApplyJob.style.display = 'none';
  }

  els.jobModal.style.display = 'flex';
}

function closeJobModal() {
  els.jobModal.style.display = 'none';
  state.selectedJob = null;
}

// ==========================================
// INTERACTIVE EVENT HANDLERS
// ==========================================

// Add Company Submit
els.addCompanyForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const url = els.companyUrlInput.value.trim();
  const name = els.companyNameInput.value.trim();

  if (!url) return;

  els.btnAddCompany.disabled = true;
  els.btnAddCompany.innerText = 'Extracting Company Details...';

  try {
    const data = await api.addCompany(url, name);
    showToast(data.message, 'success');
    els.addCompanyForm.reset();
    await refreshAllData();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    els.btnAddCompany.disabled = false;
    els.btnAddCompany.innerText = 'Add Company & Scrape';
  }
});

// Scheduler settings adjustments
els.schedIntervalSelect.addEventListener('change', async () => {
  const hours = parseFloat(els.schedIntervalSelect.value);
  try {
    await api.updateScheduler(hours, undefined);
    showToast(`Scheduler interval updated to every ${hours} hours.`, 'success');
    await loadSchedulerStatus();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// Pause / Resume Scheduler Click
els.btnPauseResume.addEventListener('click', async () => {
  const isRunning = state.scheduler.is_running;
  const nextRunningState = !isRunning;
  
  els.btnPauseResume.disabled = true;
  try {
    await api.updateScheduler(undefined, nextRunningState);
    showToast(nextRunningState ? 'Scheduler started' : 'Scheduler paused', 'success');
    await loadSchedulerStatus();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    els.btnPauseResume.disabled = false;
  }
});

// Scrape All Click
els.btnScrapeAll.addEventListener('click', async () => {
  els.btnScrapeAll.disabled = true;
  try {
    const res = await api.scrapeAll();
    showToast(res.message, 'success');
    await loadSchedulerStatus();
  } catch (err) {
    showToast(err.message, 'error');
    els.btnScrapeAll.disabled = false;
  }
});

// Refresh logs manually
els.btnRefreshLogs.addEventListener('click', async () => {
  els.btnRefreshLogs.disabled = true;
  await loadLogs();
  els.btnRefreshLogs.disabled = false;
});

// Filter Handlers
els.filterLocation.addEventListener('change', () => {
  const selectedLocations = Array.from(els.filterLocation.options)
    .filter(o => o.selected && o.value)
    .map(o => o.value)
    .join(';');
  state.filters.locations = selectedLocations;
  state.filters.page = 1;
  saveFilters();
  loadJobs();
});

els.filterStatus.addEventListener('change', () => {
  state.filters.status = els.filterStatus.value;
  state.filters.page = 1;
  saveFilters();
  loadJobs();
});

els.filterType.addEventListener('change', () => {
  state.filters.jobType = els.filterType.value;
  state.filters.page = 1;
  saveFilters();
  loadJobs();
});

els.filterTechOnly.addEventListener('change', () => {
  state.filters.techOnly = els.filterTechOnly.value;
  state.filters.page = 1;
  saveFilters();
  loadJobs();
});

els.filterFirstSeen.addEventListener('change', () => {
  state.filters.firstSeen = els.filterFirstSeen.value;
  state.filters.page = 1;
  saveFilters();
  loadJobs();
});

// Debounced Search Input
els.searchInput.addEventListener('input', () => {
  clearTimeout(state.searchDebounceTimer);
  state.searchDebounceTimer = setTimeout(() => {
    state.filters.keyword = els.searchInput.value.trim();
    state.filters.page = 1;
    saveFilters();
    loadJobs();
  }, 300);
});

// Debounced Title Keyword Input
els.filterTitleKeyword.addEventListener('input', () => {
  clearTimeout(state.searchDebounceTimer);
  state.searchDebounceTimer = setTimeout(() => {
    state.filters.titleKeyword = els.filterTitleKeyword.value.trim();
    state.filters.page = 1;
    saveFilters();
    loadJobs();
  }, 300);
});

// Debounced Exclude Title Keyword Input
els.excludeTitleKeyword.addEventListener('input', () => {
  clearTimeout(state.searchDebounceTimer);
  state.searchDebounceTimer = setTimeout(() => {
    state.filters.excludeTitleKeyword = els.excludeTitleKeyword.value.trim();
    state.filters.page = 1;
    saveFilters();
    loadJobs();
  }, 300);
});

// Clear Filters Click
els.btnClearFilters.addEventListener('click', () => {
  els.searchInput.value = '';
  els.filterTitleKeyword.value = '';
  els.excludeTitleKeyword.value = '';
  
  if (els.filterLocation) {
    Array.from(els.filterLocation.options).forEach(o => o.selected = false);
    els.filterLocation.dispatchEvent(new Event('change', { bubbles: true }));
  }

  els.filterStatus.value = ''; // Let's keep status empty (All Statuses) on clear
  els.filterType.value = '';
  els.filterTechOnly.value = '';
  if (els.filterFirstSeen) els.filterFirstSeen.value = '';
  
  state.filters.keyword = '';
  state.filters.titleKeyword = '';
  state.filters.excludeTitleKeyword = '';
  state.filters.locations = '';
  state.filters.status = '';
  state.filters.jobType = '';
  state.filters.techOnly = '';
  state.filters.firstSeen = '';
  state.filters.page = 1;
  
  saveFilters();
  loadJobs();
});

// Pagination Clicks
els.btnPrevPage.addEventListener('click', () => {
  if (state.filters.page > 1) {
    state.filters.page--;
    saveFilters();
    loadJobs();
  }
});

els.btnNextPage.addEventListener('click', () => {
  if (state.filters.page < state.pagination.pages) {
    state.filters.page++;
    saveFilters();
    loadJobs();
  }
});

// Modal Dismiss Posting Click
els.btnDeleteJob.addEventListener('click', async () => {
  if (!state.selectedJob) return;
  
  if (confirm(`Are you sure you want to dismiss and delete this job posting?`)) {
    try {
      await api.deleteJob(state.selectedJob.id);
      showToast('Job posting dismissed.', 'success');
      closeJobModal();
      await loadJobs();
      await loadStats();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }
});

// Modal Close Click
els.modalClose.addEventListener('click', closeJobModal);
window.addEventListener('click', (e) => {
  if (e.target === els.jobModal) {
    closeJobModal();
  }
});


// Edit Company Modal Close
const closeCompanyModal = () => {
  els.companyModal.style.display = 'none';
};
els.companyModalClose.addEventListener('click', closeCompanyModal);
els.btnCancelEditCompany.addEventListener('click', closeCompanyModal);
window.addEventListener('click', (e) => {
  if (e.target === els.companyModal) {
    closeCompanyModal();
  }
});

// Edit Company Form Submit
els.editCompanyForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = parseInt(els.editCompanyId.value);
  const name = els.editCompanyName.value;
  const career_url = els.editCompanyUrl.value;
  const status = els.editCompanyStatus.value;

  try {
    await api.updateCompany(id, { name, career_url, status });
    showToast('Company updated successfully.', 'success');
    closeCompanyModal();
    await refreshAllData();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// ==========================================
// TELEGRAM BROADCAST LOGIC
// ==========================================
function updateTelegramWarning(text) {
  if (text.length > 4000) {
    els.telegramCharWarning.classList.remove('hidden');
  } else {
    els.telegramCharWarning.classList.add('hidden');
  }
}

async function openTelegramModal() {
  const span = els.btnTelegramPreview.querySelector('span');
  const originalText = span ? span.innerText : 'Send to Telegram';
  els.btnTelegramPreview.disabled = true;
  if (span) span.innerText = 'Preparing...';

  try {
    const data = await api.getTelegramPreview(state.filters);
    if (!data.text || data.count === 0) {
      showToast('No jobs found matching the selected filters to send.', 'info');
      return;
    }

    els.telegramMessageText.value = data.text;
    updateTelegramWarning(data.text);
    els.telegramModal.style.display = 'flex';
  } catch (err) {
    loggerError('Error loading Telegram preview', err);
  } finally {
    els.btnTelegramPreview.disabled = false;
    if (span) span.innerText = originalText;
  }
}

function closeTelegramModal() {
  els.telegramModal.style.display = 'none';
  els.telegramMessageText.value = '';
}

// Telegram Listeners
els.btnTelegramPreview.addEventListener('click', openTelegramModal);
els.telegramModalClose.addEventListener('click', closeTelegramModal);
els.btnCancelTelegram.addEventListener('click', closeTelegramModal);

// WhatsApp Listeners
async function openWhatsappModal() {
  const span = els.btnWhatsappPreview.querySelector('span');
  const originalText = span ? span.innerText : 'Copy for WhatsApp';
  els.btnWhatsappPreview.disabled = true;
  if (span) span.innerText = 'Preparing...';

  try {
    const data = await api.getWhatsAppPreview(state.filters);
    if (!data.text || data.count === 0) {
      showToast('No jobs found matching the selected filters to copy.', 'info');
      return;
    }

    els.whatsappMessageText.value = data.text;
    els.whatsappModal.style.display = 'flex';
  } catch (err) {
    loggerError('Error loading WhatsApp preview', err);
  } finally {
    els.btnWhatsappPreview.disabled = false;
    if (span) span.innerText = originalText;
  }
}

function closeWhatsappModal() {
  els.whatsappModal.style.display = 'none';
  els.whatsappMessageText.value = '';
}

async function copyWhatsappToClipboard() {
  const text = els.whatsappMessageText.value;
  try {
    await navigator.clipboard.writeText(text);
    showToast('Copied to clipboard successfully!', 'success');
    closeWhatsappModal();
  } catch (err) {
    loggerError('Failed to copy text to clipboard', err);
  }
}

els.btnWhatsappPreview.addEventListener('click', openWhatsappModal);
els.whatsappModalClose.addEventListener('click', closeWhatsappModal);
els.btnCancelWhatsapp.addEventListener('click', closeWhatsappModal);
els.btnCopyWhatsapp.addEventListener('click', copyWhatsappToClipboard);

window.addEventListener('click', (e) => {
  if (e.target === els.telegramModal) {
    closeTelegramModal();
  }
  if (e.target === els.whatsappModal) {
    closeWhatsappModal();
  }
});

els.telegramMessageText.addEventListener('input', () => {
  updateTelegramWarning(els.telegramMessageText.value);
});

els.btnSendTelegram.addEventListener('click', async () => {
  const text = els.telegramMessageText.value.trim();
  if (!text) {
    showToast('Cannot send an empty broadcast.', 'error');
    return;
  }

  els.btnSendTelegram.disabled = true;
  const span = els.btnSendTelegram.querySelector('span');
  const originalText = span ? span.innerText : 'Send Broadcast';
  if (span) span.innerText = 'Sending...';

  try {
    const res = await api.sendTelegramMessage(text);
    showToast(res.message, 'success');
    closeTelegramModal();
  } catch (err) {
    loggerError('Failed to send broadcast', err);
  } finally {
    els.btnSendTelegram.disabled = false;
    if (span) span.innerText = originalText;
  }
});

// ==========================================
// SYSTEM UTILITIES
// ==========================================
function loggerError(msg, err) {
  console.error(`[App Error] ${msg}:`, err);
  showToast(`${msg}: ${err.message}`, 'error');
}

function saveFilters() {
  try {
    localStorage.setItem('job_tracker_filters', JSON.stringify(state.filters));
  } catch (err) {
    console.error('Error saving filters:', err);
  }
}

function loadSavedFilters() {
  try {
    const saved = localStorage.getItem('job_tracker_filters');
    if (saved) {
      const parsed = JSON.parse(saved);
      // Merge saved filters into state.filters
      state.filters = { ...state.filters, ...parsed };
      
      // Update DOM values
      if (els.searchInput) els.searchInput.value = state.filters.keyword || '';
      if (els.filterTitleKeyword) els.filterTitleKeyword.value = state.filters.titleKeyword || '';
      if (els.excludeTitleKeyword) els.excludeTitleKeyword.value = state.filters.excludeTitleKeyword || '';
      
      if (els.filterLocation && state.filters.locations) {
        const savedLocations = state.filters.locations.split(';').filter(Boolean);
        Array.from(els.filterLocation.options).forEach(o => {
          o.selected = savedLocations.includes(o.value);
        });
        els.filterLocation.dispatchEvent(new Event('change', { bubbles: true }));
      }

      if (els.filterStatus) els.filterStatus.value = state.filters.status || '';
      if (els.filterType) els.filterType.value = state.filters.jobType || '';
      if (els.filterTechOnly) els.filterTechOnly.value = state.filters.techOnly || '';
      if (els.filterFirstSeen) els.filterFirstSeen.value = state.filters.firstSeen || '';
    }
  } catch (err) {
    console.error('Error loading saved filters:', err);
  }
}

async function refreshAllData() {
  await Promise.all([
    loadStats(),
    loadCompanies(),
    loadLocations(),
    loadJobs(),
    loadSchedulerStatus(),
    loadLogs()
  ]);
}

// Initializer
async function init() {
  loadSavedFilters();
  await refreshAllData();
  
  // Set up polling for status updates every 6 seconds to keep dashboard fresh
  setInterval(() => {
    loadSchedulerStatus();
    loadStats();
    loadLogs();
  }, 6000);
}

// Start
init();
