import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.resolve('data/jobs.db');
console.log(`Connecting to database at: ${dbPath}`);
const db = new Database(dbPath);

// 1. Ensure columns exist in companies table
try {
  db.exec("ALTER TABLE companies ADD COLUMN payscale TEXT;");
  console.log("Added payscale column to companies table.");
} catch (e) {
  // Column already exists
}
try {
  db.exec("ALTER TABLE companies ADD COLUMN classification TEXT;");
  console.log("Added classification column to companies table.");
} catch (e) {
  // Column already exists
}

const companies = [
  { name: "Optimizely", url: "https://careers.optimizely.com/", payscale: "120,000 - 350,000+", classification: "Global MNC (Product Engineering)" },
  { name: "Field Nation", url: "https://fieldnation.com/careers", payscale: "100,000 - 300,000+", classification: "US MNC (Labor Marketplace Platform)" },
  { name: "bKash Limited", url: "https://www.bkash.com/en/career", payscale: "80,000 - 250,000+", classification: "Local Fintech Unicorn" },
  { name: "IQVIA", url: "https://jobs.iqvia.com/", payscale: "60,000 - 80,000", classification: "Global Healthcare Tech" },
  { name: "Fiftytwo Digital Ltd.", url: "https://fiftytwodigital.com/careers/", payscale: "70,000 - 80,000", classification: "European IT Services" },
  { name: "Cefalo Bangladesh Ltd.", url: "https://career.cefalo.com/", payscale: "30,000 - 50,000 (Trainee) / 80,000+ (Assoc)", classification: "Norwegian MNC (Outsourcing)" },
  { name: "Samsung R&D (SRBD)", url: "https://research.samsung.com/careers", payscale: "40,000 - 80,000", classification: "Global MNC (R&D Center)" },
  { name: "iFarmer Limited", url: "https://www.ifarmer.asia/careers", payscale: "60,000 - 70,000", classification: "Agri-Tech Startup" },
  { name: "Pathao", url: "https://careers.pathao.com/", payscale: "30,000 - 70,000", classification: "Local Super App Startup" },
  { name: "Kite Games Studio", url: "https://www.kitegamesstudio.com/", payscale: "55,000 - 65,000", classification: "Mobile App & Game Development" },
  { name: "Astha IT", url: "https://ait.inc/career/", payscale: "50,000+", classification: "Enterprise Software" },
  { name: "SELISE Digital Platforms", url: "https://selisegroup.com/job-application/", payscale: "25,000 - 40,000 (Trainee) / up to 60,000+", classification: "Swiss MNC (Enterprise Platforms)" },
  { name: "Brain Station 23", url: "https://brainstation.io/careers", payscale: "25,000 - 45,000+ (Star Coder Program)", classification: "Large Local IT Services" },
  { name: "Kona Software Lab", url: "https://www.konasl.net/careers", payscale: "40,000 - 50,000", classification: "South Korean MNC (FinTech)" },
  { name: "Monstar Lab Bangladesh", url: "https://monstar-lab.com/bd/", payscale: "40,000 - 50,000", classification: "Global Digital Consulting" },
  { name: "Orbitax Bangladesh", url: "https://www.orbitax.com/", payscale: "40,000 - 50,000", classification: "Global Tax Software" },
  { name: "Kaz Software", url: "https://www.kaz.com.bd/company/career", payscale: "30,000 - 45,000", classification: "Custom Software & AI" },
  { name: "Therap (BD) Ltd.", url: "https://www.therapservices.net/jobs/", payscale: "25,000 - 40,000 (Probation) / 40,001 - 50,000", classification: "US SaaS (Healthcare Tech)" },
  { name: "Enosis Solutions", url: "https://enosisbd.pinpointhq.com/", payscale: "22,000 - 35,000+ (Trainee) / 40,000+", classification: "North American Product Engineering" },
  { name: "TigerIT Bangladesh Ltd.", url: "https://www.tigerit.com/", payscale: "40,001 - 50,000", classification: "Specialized Enterprise (Biometrics)" },
  { name: "WellDev Bangladesh", url: "https://www.welldev.io/careers", payscale: "30,000 - 50,000 (Junior) / 70,000+ (Mid)", classification: "Swiss IT Services" },
  { name: "weDevs", url: "https://wedevs.com/career/", payscale: "25,000 - 45,000", classification: "WordPress Product Company" },
  { name: "Ollyo", url: "https://ollyo.com/careers/", payscale: "25,000 - 45,000", classification: "WordPress & Web Tech" },
  { name: "ReliSource", url: "https://www.relisource.com/careers/", payscale: "25,000 - 45,000", classification: "Healthcare & Telecom Tech" },
  { name: "Nascenia", url: "https://nascenia.com/", payscale: "30,000 - 40,000", classification: "Ruby on Rails & Custom Dev" },
  { name: "6sense Technologies", url: "https://www.6sensehq.com/", payscale: "40,001 - 50,000 (Junior Backend)", classification: "Custom Software Development" },
  { name: "Sazim Tech", url: "https://www.sazim.io/careers", payscale: "30,000 - 40,000 (Trainee)", classification: "AI & Machine Learning Engineering" },
  { name: "Neural Semiconductor", url: "https://www.neural-semiconductor.com/career", payscale: "20,000 - 40,000 (Trainee Engineer)", classification: "VLSI & Hardware Design" },
  { name: "BJIT Group", url: "https://bjitgroup.com/career", payscale: "20,000 - 35,000 (BJIT Academy)", classification: "Global IT Services" },
  { name: "NewsCred (Welcome Software)", url: "N/A (Repository Sourced)", payscale: "70,000 - 100,000 (Software Engineer)", classification: "Content Marketing Platform" },
  { name: "S3 Innovative Bangladesh", url: "N/A (Repository Sourced)", payscale: "40,000 - 50,000 (Jr. Software Engineer)", classification: "IT Services" },
  { name: "Mojaru Education Tech", url: "N/A (Repository Sourced)", payscale: "35,000 - 40,000 (Full Stack Fresher)", classification: "Educational Technology Startup" },
  { name: "Smarter AI (AnyConnect)", url: "N/A (Repository Sourced)", payscale: "40,000 - 120,000 (Software Engineer)", classification: "AI Camera & Video Analytics" },
  { name: "Ami Probashi Ltd.", url: "N/A (Repository Sourced)", payscale: "40,001 - 50,000 (Product Analyst)", classification: "Technology Initiative" },
  { name: "Anchorblock Technology", url: "N/A (Repository Sourced)", payscale: "40,001 - 50,000 (Quantitative Analyst)", classification: "FinTech / Data Science" },
  { name: "AnnonLab Ltd.", url: "N/A (Repository Sourced)", payscale: "40,001 - 50,000 (Jr. Software Engineer)", classification: "Custom Software Development" },
  { name: "a1qa", url: "N/A (Repository Sourced)", payscale: "30,001 - 40,000 (Jr. QA Automation)", classification: "QA & Testing Services" },
  { name: "Agile Crafts", url: "N/A (Repository Sourced)", payscale: "30,001 - 40,000 (Software Testing Eng.)", classification: "QA & Testing Services" },
  { name: "Workspace Infotech", url: "N/A (Repository Sourced)", payscale: "30,001 - 40,000 (Jr. Software Engineer)", classification: "IT Services" },
  { name: "Surbana Jurong", url: "N/A (Repository Sourced)", payscale: "30,000 - 100,000 (Software Engineer)", classification: "Urban & Infrastructure Tech" },
  { name: "Cloudly Infotech", url: "N/A (Repository Sourced)", payscale: "20,000 - 40,000 (Frontend Engineer)", classification: "Cloud Infrastructure Services" },
  { name: "Zone7", url: "N/A (Repository Sourced)", payscale: "25,000 - 35,000 (Jr. Technical Support)", classification: "IT Support & Logistics" }
];

async function checkAndSeed() {
  console.log(`Starting seeding of ${companies.length} companies...`);
  const stmt = db.prepare(`
    INSERT INTO companies (name, career_url, payscale, classification, status, last_error)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(career_url) DO UPDATE SET
      name = excluded.name,
      payscale = excluded.payscale,
      classification = excluded.classification,
      status = excluded.status,
      last_error = excluded.last_error,
      updated_at = datetime('now')
  `);

  for (let i = 0; i < companies.length; i++) {
    const comp = companies[i];
    let status = 'active';
    let lastError = null;

    if (!comp.url || comp.url.startsWith('N/A')) {
      status = 'error';
      lastError = 'Link is missing (Repository Sourced)';
      console.log(`[${i + 1}/${companies.length}] ${comp.name} - Missing link.`);
    } else {
      // Test URL validity
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
          console.log(`[${i + 1}/${companies.length}] ${comp.name} - Broken link (HTTP Status ${res.status}).`);
        } else {
          console.log(`[${i + 1}/${companies.length}] ${comp.name} - Link is healthy.`);
        }
      } catch (err) {
        clearTimeout(timeoutId);
        status = 'error';
        lastError = `Link broken (Network Error: ${err.message})`;
        console.log(`[${i + 1}/${companies.length}] ${comp.name} - Connection failed: ${err.message}`);
      }
    }

    try {
      stmt.run(comp.name, comp.url, comp.payscale, comp.classification, status, lastError);
    } catch (dbErr) {
      console.error(`Failed to insert ${comp.name}:`, dbErr.message);
    }
  }

  console.log("\nSeeding complete!");
}

checkAndSeed().catch(err => {
  console.error("Seeding failed:", err);
});
