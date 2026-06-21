import { getFilteredJobs } from '../db/queries.js';

console.log('Testing keyword search for company: "IQVIA"');
const result = getFilteredJobs({ keyword: 'IQVIA' });
console.log(`Found ${result.jobs.length} jobs (Total: ${result.total})`);

if (result.jobs.length > 0) {
  console.log('Sample match:', {
    title: result.jobs[0].title,
    company: result.jobs[0].company_name
  });
}
