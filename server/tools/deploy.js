const HEALTH_URL = 'https://icarus-production-5c67.up.railway.app/health';

export async function deployCheck(waitSeconds = 45) {
  try {
    console.log(`[deploy_check] waiting ${waitSeconds}s for Railway redeploy…`);
    await new Promise(r => setTimeout(r, waitSeconds * 1000));

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`[deploy_check] health check attempt ${attempt}/3`);
        const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(8000) });
        if (res.ok) {
          const body = await res.json().catch(() => ({}));
          return { success: true, message: `Deploy OK (attempt ${attempt}): ${JSON.stringify(body)}` };
        }
        console.log(`[deploy_check] attempt ${attempt} got HTTP ${res.status}`);
      } catch (err) {
        console.log(`[deploy_check] attempt ${attempt} error: ${err.message}`);
      }
      if (attempt < 3) await new Promise(r => setTimeout(r, 10000));
    }

    return { success: false, message: 'Health check failed after 3 attempts — deploy may still be in progress' };
  } catch (err) {
    return { success: false, message: `deploy_check error: ${err.message}` };
  }
}
