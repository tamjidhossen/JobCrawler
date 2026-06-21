import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.resolve('data/jobs.db');
console.log(`Connecting to database at: ${dbPath}`);
const db = new Database(dbPath);

const list = [
  { name: "Optimizely", url: "https://careers.optimizely.com/" },
  { name: "Field Nation", url: "https://fieldnation.com/careers" },
  { name: "bKash Limited", url: "https://www.bkash.com/en/career" },
  { name: "IQVIA", url: "https://jobs.iqvia.com/" },
  { name: "Fiftytwo Digital Ltd.", url: "https://fiftytwodigital.com/careers/" },
  { name: "Cefalo Bangladesh Ltd.", url: "https://career.cefalo.com/" },
  { name: "Samsung R&D (SRBD)", url: "https://research.samsung.com/careers" },
  { name: "iFarmer Limited", url: "https://www.ifarmer.asia/careers" },
  { name: "Pathao", url: "https://careers.pathao.com/" },
  { name: "Kite Games Studio", url: "https://www.kitegamesstudio.com/" },
  { name: "Astha IT", url: "https://ait.inc/career/" },
  { name: "SELISE Digital Platforms", url: "https://selisegroup.com/job-application/" },
  { name: "Brain Station 23", url: "https://brainstation.io/careers" },
  { name: "Kona Software Lab", url: "https://www.konasl.net/careers" },
  { name: "Monstar Lab Bangladesh", url: "https://monstar-lab.com/bd/" },
  { name: "Orbitax Bangladesh", url: "https://www.orbitax.com/" },
  { name: "Kaz Software", url: "https://www.kaz.com.bd/company/career" },
  { name: "Therap (BD) Ltd.", url: "https://www.therapservices.net/jobs/" },
  { name: "Enosis Solutions", url: "https://enosisbd.pinpointhq.com/" },
  { name: "TigerIT Bangladesh Ltd.", url: "https://www.tigerit.com/" },
  { name: "WellDev Bangladesh", url: "https://www.welldev.io/careers" },
  { name: "weDevs", url: "https://wedevs.com/career/" },
  { name: "Ollyo", url: "https://ollyo.com/careers/" },
  { name: "ReliSource", url: "https://www.relisource.com/careers/" },
  { name: "Nascenia", url: "https://nascenia.com/careers/" },
  { name: "6sense Technologies", url: "https://6sense.com/careers/" },
  { name: "Sazim Tech", url: "https://www.sazim.io/careers" },
  { name: "Neural Semiconductor", url: "https://www.neural-semiconductor.com/career" },
  { name: "BJIT Group", url: "https://bjitgroup.com/career" },
  { name: "NewsCred (Welcome Software)", url: "https://careers.optimizely.com/?ref=newscred" }, // Unique query param to satisfy DB constraint
  { name: "S3 Innovative Bangladesh", url: "https://www.s3innovate.com/" },
  { name: "Mojaru Education Tech", url: "https://mojaru.com/en/career" },
  { name: "Smarter AI (AnyConnect)", url: "https://anyconnect.com/careers/" },
  { name: "Ami Probashi Ltd.", url: "https://amiprobashi.com/" },
  { name: "Anchorblock Technology", url: "https://anchorblock.ai/" },
  { name: "AnnonLab Ltd.", url: "https://annonlab.com/" },
  { name: "a1qa", url: "https://a1qa.com/careers/" },
  { name: "Agile Crafts", url: "https://www.agilecrafts.com/career/" },
  { name: "Workspace Infotech", url: "https://workspaceit.com/career/" },
  { name: "Surbana Jurong", url: "https://www.sjgroup.com/careers/" },
  { name: "Cloudly Infotech", url: "https://cloudly.com.bd/careers/" },
  { name: "Zone7", url: "https://zone7.ai/careers/" }
];

async function runUpdates() {
  console.log(`Starting URL updates and health checks for ${list.length} companies...`);
  
  // Prepare statements
  const checkStmt = db.prepare("SELECT id FROM companies WHERE name = ?");
  const updateStmt = db.prepare(`
    UPDATE companies 
    SET career_url = ?, status = ?, last_error = ?, last_listing_hash = NULL, last_scraped_at = NULL, updated_at = datetime('now')
    WHERE name = ?
  `);
  const insertStmt = db.prepare(`
    INSERT INTO companies (name, career_url, status, last_error)
    VALUES (?, ?, ?, ?)
  `);

  for (let i = 0; i < list.length; i++) {
    const comp = list[i];
    let status = 'active';
    let lastError = null;

    console.log(`[${i + 1}/${list.length}] Checking: ${comp.name} (${comp.url})`);

    // Test URL health
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s timeout
    try {
      const res = await fetch(comp.url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        },
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (res.status >= 400) {
        status = 'error';
        lastError = `Link broken (HTTP Status ${res.status})`;
        console.log(`  → Broken link (HTTP Status ${res.status})`);
      } else {
        console.log(`  → Link is healthy`);
      }
    } catch (err) {
      clearTimeout(timeoutId);
      status = 'error';
      lastError = `Link broken (Network Error: ${err.message})`;
      console.log(`  → Connection failed: ${err.message}`);
    }

    // Check if company exists by name
    const existing = checkStmt.get(comp.name);
    if (existing) {
      try {
        updateStmt.run(comp.url, status, lastError, comp.name);
        console.log(`  → Updated in DB.`);
      } catch (err) {
        console.error(`  → Update failed: ${err.message}`);
      }
    } else {
      try {
        insertStmt.run(comp.name, comp.url, status, lastError);
        console.log(`  → Inserted as new company in DB.`);
      } catch (err) {
        console.error(`  → Insertion failed: ${err.message}`);
      }
    }
  }

  console.log("\nUpdate and health checks completed successfully!");
}

runUpdates().catch(err => {
  console.error("Updates failed:", err);
});
