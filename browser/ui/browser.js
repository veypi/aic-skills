import { browserCall } from './command.js';
export { browserCall } from './command.js';

// Browser state belongs to the device tool. Connections own only forwarding.
export class BrowserDirectory {
  constructor(hosts, changed = () => {}) {
    this.hosts = hosts;
    this.changed = changed;
    this.connections = new Map();
    this.revisions = new Map();
    this.closed = false;
  }
  async refresh({ retryFailed = false } = {}) {
    if (this.pending) return this.pending;
    this.pending = this.load({ retryFailed }).finally(() => {
      this.pending = null;
    });
    return this.pending;
  }
  async load({ retryFailed = false } = {}) {
    const query = this.hosts.query({});
    let hosts;
    try { hosts = [...await query.load()]; } finally { query.dispose(); }
    if (this.closed) return;
    const wanted = new Set(
      hosts.filter((h) => h.status === 'enabled').map((h) => h.id),
    );
    for (const [id, connection] of this.connections)
      if (!wanted.has(id) || connection.closed) {
        this.connections.delete(id);
        await connection.close().catch(() => {});
      }
    const rows = hosts.map(
      (host) =>
        this.rows?.find((r) => r.id === host.id) || {
          id: host.id,
          name: host.name || host.id,
          status: 'connecting',
          error: '',
          pages: [],
        },
    );
    this.rows = rows;
    this.changed(rows.filter(Boolean));
    let next = 0;
    // A slow/unreachable device must not hold up discovery of the other devices.
    const worker = async () => {
      while (!this.closed && next < hosts.length) {
        const index = next++,
          host = hosts[index];
        const row = {
          id: host.id,
          name: host.name || host.hostname || host.id,
          status: 'connecting',
          error: '',
          pages: [],
        };

        if (host.status !== 'enabled') row.status = 'disabled';
        else if (
          host.last_seen &&
          Date.now() - Date.parse(host.last_seen) > 40000
        )
          row.status = 'offline';
        else if (
          !host.caps?.transports?.rtc?.enabled ||
          host.caps?.transports?.rtc?.protocol !== 'hosts_rtc/3'
        )
          row.status = 'unavailable';
        else if (rows[index].status === 'error' && !retryFailed) {
          row.status = 'error';
          row.error = rows[index].error;
        } else {
          const revision = this.revisions.get(host.id) || 0;
          try {
            let connection = this.connections.get(host.id);
            if (!connection) {
              rows[index] = row;
              this.changed(rows.filter(Boolean));
              connection = await this.hosts.openTools(host.id);
              if (this.closed) {
                await connection.close();
                return;
              }
              this.connections.set(host.id, connection);
            }
            if (rows[index].status !== 'ready') {
              row.status = 'starting';
              rows[index] = row;
              this.changed(rows.filter(Boolean));
            }
            const result = await browserCall(connection, 'agent_browser_tab_list');
            if (this.closed || revision !== (this.revisions.get(host.id) || 0)) continue;
            row.status = 'ready';
            const pages = result.structuredContent?.response?.data?.tabs;
            if (!Array.isArray(pages)) throw new Error('Invalid agent-browser tab list');
            row.pages = pages;
          } catch (error) {
            if (this.closed || revision !== (this.revisions.get(host.id) || 0)) continue;
            row.status = 'error';
            row.error = error.message;
            const connection = this.connections.get(host.id);
            this.connections.delete(host.id);
            await connection?.close().catch(() => {});
          }
          if (this.closed || revision !== (this.revisions.get(host.id) || 0)) continue;
        }
        rows[index] = row;
        if (!this.closed) this.changed(rows.filter(Boolean));
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(4, hosts.length) }, worker),
    );
    if (!this.closed) this.changed(rows.filter(Boolean));
    return rows;
  }
  setPages(hostId, pages) {
    if (!Array.isArray(pages)) throw new Error('Invalid agent-browser tab list');
    if (this.closed) return;
    const row = this.rows?.find((item) => item.id === hostId);
    if (!row) return;
    this.revisions.set(hostId, (this.revisions.get(hostId) || 0) + 1);
    Object.assign(row, { pages, status: 'ready', error: '' });
    this.changed(this.rows.filter(Boolean));
  }
  connection(hostId) {
    return this.connections.get(hostId);
  }
  async close() {
    this.closed = true;
    this.revisions.clear();
    const connections = [...this.connections.values()];
    this.connections.clear();
    await Promise.all(connections.map((s) => s.close().catch(() => {})));
  }
}
