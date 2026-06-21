import express from 'express';
import * as queries from '../db/queries.js';
import { scheduler } from '../services/scheduler.js';
import { companyNameFromUrl } from '../utils/company-name.js';
import { logger } from '../utils/logger.js';
import { normalizeUrl, getHostname, isMultiTenantHost } from '../utils/url.js';

const router = express.Router();

// List all companies
router.get('/', (req, res) => {
  try {
    const companies = queries.getCompanies();
    res.json(companies);
  } catch (err) {
    logger.error('Failed to get companies list', { error: err.message });
    res.status(500).json({ error: 'Failed to retrieve companies list.' });
  }
});

// Create a new company
router.post('/', async (req, res) => {
  const { career_url, name } = req.body;

  if (!career_url) {
    return res.status(400).json({ error: 'career_url is required.' });
  }

  try {
    const normalizedUrl = normalizeUrl(career_url);
    // Check if company already exists
    const existing = queries.getCompanyByUrl(normalizedUrl);
    if (existing) {
      return res.status(400).json({ error: 'A company with this career URL already exists.' });
    }

    // Hostname duplicate check (for non-multi-tenant sites)
    const host = getHostname(normalizedUrl);
    if (host && !isMultiTenantHost(host)) {
      const allCompanies = queries.getCompanies();
      const duplicateHostCompany = allCompanies.find(c => {
        const cHost = getHostname(c.career_url);
        return cHost === host;
      });

      if (duplicateHostCompany) {
        return res.status(400).json({
          error: `A company on the domain "${host}" already exists: "${duplicateHostCompany.name}".`
        });
      }
    }

    let finalName = name;

    // Derive name from URL with zero API calls — fast and free
    if (!finalName) {
      finalName = companyNameFromUrl(career_url);
      logger.info(`Derived company name from URL: "${finalName}"`);
    }

    const companyId = queries.insertCompany(finalName, normalizedUrl);
    const newCompany = queries.getCompanyById(companyId);

    // Trigger an initial scrape of this company in the background
    scheduler.triggerManualScrapeCompany(companyId).catch(err => {
      logger.error(`Failed background initial scrape for newly added company: ${err.message}`);
    });

    res.status(201).json({
      message: 'Company added successfully. Scrape initiated in background.',
      company: newCompany
    });
  } catch (err) {
    logger.error('Failed to add company', { error: err.message });
    res.status(500).json({ error: `Failed to add company: ${err.message}` });
  }
});

// Update company status/name/url
router.put('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const { name, career_url, status } = req.body;

  try {
    const existing = queries.getCompanyById(id);
    if (!existing) {
      return res.status(404).json({ error: 'Company not found.' });
    }

    const normalizedUrl = career_url ? normalizeUrl(career_url) : existing.career_url;
    if (career_url && normalizedUrl !== existing.career_url) {
      const duplicate = queries.getCompanyByUrl(normalizedUrl);
      if (duplicate) {
        return res.status(400).json({ error: 'A company with this career URL already exists.' });
      }

      // Hostname duplicate check (for non-multi-tenant sites)
      const host = getHostname(normalizedUrl);
      if (host && !isMultiTenantHost(host)) {
        const allCompanies = queries.getCompanies();
        const duplicateHostCompany = allCompanies.find(c => {
          const cHost = getHostname(c.career_url);
          return cHost === host && c.id !== id;
        });

        if (duplicateHostCompany) {
          return res.status(400).json({
            error: `A company on the domain "${host}" already exists: "${duplicateHostCompany.name}".`
          });
        }
      }
    }

    queries.updateCompany(id, { name, career_url: normalizedUrl, status });
    const updated = queries.getCompanyById(id);
    res.json({ message: 'Company updated successfully.', company: updated });
  } catch (err) {
    logger.error(`Failed to update company ID ${id}`, { error: err.message });
    res.status(500).json({ error: 'Failed to update company.' });
  }
});

// Delete company
router.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id);

  try {
    const existing = queries.getCompanyById(id);
    if (!existing) {
      return res.status(404).json({ error: 'Company not found.' });
    }

    queries.deleteCompany(id);
    res.json({ message: 'Company and associated jobs deleted successfully.' });
  } catch (err) {
    logger.error(`Failed to delete company ID ${id}`, { error: err.message });
    res.status(500).json({ error: 'Failed to delete company.' });
  }
});

// Trigger immediate scrape for a single company
router.post('/:id/scrape', async (req, res) => {
  const id = parseInt(req.params.id);

  try {
    const result = await scheduler.triggerManualScrapeCompany(id);
    res.json(result);
  } catch (err) {
    logger.error(`Failed manual scrape trigger for company ID ${id}`, { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

export default router;
