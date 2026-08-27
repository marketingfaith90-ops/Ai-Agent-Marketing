export default async function handler(req, res) {
  const WEBHOOK = process.env.BITRIX24_WEBHOOK;
  const GROUP_ID = process.env.BITRIX24_MARKETING_GROUP_ID;

  try {
    // Test 1 - check connection
    const testUrl = `${WEBHOOK}tasks.task.list?filter[GROUP_ID]=${GROUP_ID}&select[]=ID&select[]=TITLE&select[]=STATUS&select[]=CREATED_DATE`;
    const r = await fetch(testUrl, { signal: AbortSignal.timeout(8000) });
    const d = await r.json();

    return res.status(200).json({
      webhook_set: !!WEBHOOK,
      group_id: GROUP_ID,
      total_tasks: d.result?.tasks?.length || 0,
      error: d.error || null,
      sample_tasks: d.result?.tasks?.slice(0, 5).map(t => ({
        id: t.ID,
        title: t.TITLE,
        status: t.STATUS,
        created: t.CREATED_DATE
      })) || []
    });
  } catch(e) {
    return res.status(200).json({ error: e.message });
  }
}
