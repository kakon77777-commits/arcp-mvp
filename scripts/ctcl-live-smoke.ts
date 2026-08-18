import { CtclRestTemporalAdapter } from '@arcp/adapter-ctcl';

if (process.env.ARCP_CTCL_LIVE !== '1') {
  console.error('Refusing live CTCL smoke: set ARCP_CTCL_LIVE=1 explicitly.');
  process.exitCode = 2;
} else {
  const a = new CtclRestTemporalAdapter();
  const b = new CtclRestTemporalAdapter();

  try {
    const now = await a.now();
    const registered = await a.registerInstant({
      label: `arcp-phase3-smoke-${Date.now()}`,
    });
    const retrieved = await b.getInstant(registered.instant.instant_id);
    const sameCanonicalInstant =
      retrieved.canonicalUnixNs !== null &&
      retrieved.canonicalUnixNs === registered.canonicalUnixNs;

    if (!sameCanonicalInstant) process.exitCode = 1;

    console.log(JSON.stringify({
      now_instant_id: now.instant.instant_id,
      registered_instant_id: registered.instant.instant_id,
      same_canonical_instant: sameCanonicalInstant,
      source_precision: now.sourceQuality.precision,
    }));
  } catch (error) {
    process.exitCode = 1;
    console.error(JSON.stringify({
      live_smoke: 'failed',
      error_name: error instanceof Error ? error.name : 'UnknownError',
      error_message: error instanceof Error ? error.message : 'unknown CTCL live-smoke failure',
    }));
  }
}
