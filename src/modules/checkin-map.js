import { api, map, ago } from '../lib/core.js';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
/* Component: Bản đồ check-in nhóm — gom mọi điểm check-in GPS mà user được quyền xem.
   Dùng Leaflet + OpenStreetMap (miễn phí, không cần API key). Bấm marker mở bài viết gốc. */
const CMap = {
  data() { return { items: [], busy: true, err: '', inited: false, post: null, postBusy: false }; },
  async mounted() { await this.load(); },
  methods: {
    ago,
    async load() {
      this.busy = true; this.err = '';
      try {
        this.items = await api('GET', '/checkins');
      } catch (e) { this.err = e.message; }
      finally { this.busy = false; }
      this.$nextTick(() => this.initMap());
    },
    initMap() {
      if (this.inited || !this.$refs.mapEl) return;
      this.inited = true;
      const el = this.$refs.mapEl;
      // Trung tâm mặc định: Việt Nam; nếu có điểm thì fit theo điểm
      const m = L.map(el, { zoomControl: true }).setView([14.0, 108.0], 6);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(m);
      this._map = m;
      this.renderMarkers();
    },
    renderMarkers() {
      const m = this._map;
      if (!m) return;
      if (this._layer) m.removeLayer(this._layer);
      this._layer = L.layerGroup().addTo(m);
      const pts = [];
      for (const it of this.items) {
        const { lat, lng } = it.location || {};
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        pts.push([lat, lng]);
        const mk = L.marker([lat, lng]).addTo(this._layer);
        const html = '<div style="min-width:180px;max-width:240px">' +
          '<b>' + this.esc(it.name) + '</b><br>' +
          '<span style="color:#666;font-size:12px">📍 ' + this.esc(it.location.name) + '</span><br>' +
          (it.text ? '<span style="font-size:13px">' + this.esc(it.text) + '</span><br>' : '') +
          '<span style="color:#999;font-size:11px">' + this.ago(it.createdAt) + '</span><br>' +
          '<button data-post="' + it.postId + '" class="map-open-post" style="margin-top:6px;padding:4px 12px;border-radius:8px;background:#2C629E;color:#fff;border:0;cursor:pointer">Xem bài viết</button></div>';
        mk.bindPopup(html);
      }
      // Gắn sự kiện cho nút trong popup (delegate vì popup render động)
      m.on('popupopen', (e) => {
        const btn = e.popup.getElement().querySelector('.map-open-post');
        if (btn) btn.onclick = () => this.openPost(btn.getAttribute('data-post'));
      });
      if (pts.length) m.fitBounds(pts.length === 1 ? [pts[0], pts[0]] : pts, { padding: [40, 40], maxZoom: 14 });
    },
    esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },
    async openPost(postId) {
      this.postBusy = true; this.post = null;
      try {
        const p = await api('GET', '/posts/' + encodeURIComponent(postId));
        this.post = map(p);
      } catch (e) { alert(e.message); }
      finally { this.postBusy = false; }
    },
    closePost() { this.post = null; },
  },
  template: `<div class="space-y-3">
  <div v-if="busy" class="card p-6 text-center text-mute">Đang tải bản đồ check-in…</div>
  <div v-else-if="err" class="card p-6 text-center"><p class="text-mute">{{ err }}</p><button class="btn mt-3" @click="load">Thử lại</button></div>
  <template v-else>
    <div v-if="!items.length" class="card p-6 text-center text-mute">Chưa có điểm check-in nào.<br>Hãy là người đầu tiên check-in nhé! 📍</div>
    <div v-show="items.length" ref="mapEl" class="card overflow-hidden" style="height:min(70vh,560px);min-height:320px;z-index:0"></div>
    <p v-if="items.length" class="text-xs text-mute text-center">{{ items.length }} điểm check-in · Bấm vào từng điểm để xem bài viết</p>
  </template>
  <teleport to="body">
    <div v-if="postBusy || post" class="fixed inset-0 z-[1000] flex items-center justify-center p-4" style="background:rgba(0,0,0,.5)" @click.self="closePost">
      <div class="card max-w-lg w-full max-h-[85vh] overflow-auto p-1">
        <div class="flex justify-end p-2"><button class="gh" @click="closePost" aria-label="Đóng">✕</button></div>
        <div v-if="postBusy" class="p-6 text-center text-mute">Đang tải bài viết…</div>
        <c-post v-else-if="post" :post="post"></c-post>
      </div>
    </div>
  </teleport>
</div>`,
};
/* Component: Bản đồ check-in nhóm cho trang Quản trị — thấy mọi check-in (cả bài riêng tư), lọc, gỡ vị trí hoặc xóa bài.
   Marker tô màu theo chế độ xem: xanh lá = công khai, xanh dương = bạn bè, xám = riêng tư. */
const VCOL = { public: '#2e9e5b', friends: '#2C629E', private: '#8a8f98' };
const VLAB = { public: 'Công khai', friends: 'Bạn bè', private: 'Riêng tư' };
const AdminMap = {
  data() { return { items: [], total: 0, busy: true, err: '', q: '', vis: '', days: 30, sel: '', mbusy: '', VLAB }; },
  async mounted() { this.initMap(); await this.load(); },
  beforeUnmount() { if (this._map) { this._map.remove(); this._map = null; } },
  methods: {
    ago,
    esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },
    initMap() {
      const el = this.$refs.mapEl;
      if (this._map || !el) return;
      const m = L.map(el).setView([14.0, 108.0], 6);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(m);
      this._map = m; this._mk = {};
      setTimeout(() => m.invalidateSize(), 200);   // tab vừa mở: tính lại kích thước khung bản đồ
    },
    async load() {
      this.busy = true; this.err = '';
      try {
        const qs = 'q=' + encodeURIComponent(this.q) + '&vis=' + this.vis + '&days=' + this.days;
        const r = await api('GET', '/admin/checkins?' + qs);
        this.items = r.items || []; this.total = r.total || 0;
      } catch (e) { this.err = e.message; this.items = []; this.total = 0; }
      finally { this.busy = false; }
      this.renderMarkers(true);
    },
    renderMarkers(fit) {
      const m = this._map; if (!m) return;
      if (this._layer) m.removeLayer(this._layer);
      this._layer = L.layerGroup().addTo(m); this._mk = {};
      const pts = [];
      for (const it of this.items) {
        const { lat, lng } = it.location;
        pts.push([lat, lng]);
        const mk = L.circleMarker([lat, lng], { radius: 9, weight: 2, color: '#fff', fillColor: VCOL[it.visibility] || VCOL.public, fillOpacity: 0.95 }).addTo(this._layer);
        mk.bindPopup('<div style="min-width:170px;max-width:230px"><b>' + this.esc(it.name) + '</b><br><span style="color:#666;font-size:12px">📍 ' +
          this.esc(it.location.name) + '</span><br><span style="color:#999;font-size:11px">' + this.esc(VLAB[it.visibility] || it.visibility) + ' · ' + this.ago(it.createdAt) + '</span></div>');
        mk.on('click', () => { this.sel = it.postId; });
        this._mk[it.postId] = mk;
      }
      if (fit && pts.length) m.fitBounds(pts.length === 1 ? [pts[0], pts[0]] : pts, { padding: [30, 30], maxZoom: 14 });
    },
    pick(it) {
      this.sel = it.postId;
      const m = this._map; if (!m) return;
      m.setView([it.location.lat, it.location.lng], Math.max(m.getZoom(), 14));
      const mk = this._mk[it.postId]; if (mk) mk.openPopup();
      if (this.$refs.mapEl) this.$refs.mapEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    },
    drop(it) { this.items = this.items.filter(x => x.postId !== it.postId); this.total = Math.max(0, this.total - 1); this.renderMarkers(false); },
    async clearLoc(it) {
      if (!confirm('Gỡ vị trí "' + it.location.name + '" khỏi bài của ' + it.name + '? Bài viết vẫn được giữ lại.')) return;
      this.mbusy = it.postId;
      try { await api('POST', '/admin/checkins/' + encodeURIComponent(it.postId) + '/clear'); this.drop(it); }
      catch (e) { alert(e.message); } finally { this.mbusy = ''; }
    },
    async delPost(it) {
      if (!confirm('XÓA HẲN bài viết của ' + it.name + ' tại "' + it.location.name + '"? Không khôi phục được.')) return;
      this.mbusy = it.postId;
      try { await api('DELETE', '/admin/mod/posts/' + encodeURIComponent(it.postId)); this.drop(it); }
      catch (e) { alert(e.message); } finally { this.mbusy = ''; }
    },
  },
  template: `<div class="space-y-3">
  <div class="card p-3 space-y-2">
    <div class="flex flex-wrap gap-2 items-center">
      <input v-model.trim="q" class="ip" style="flex:1;min-width:150px" maxlength="60" placeholder="Tìm địa điểm, nội dung, người đăng" @keyup.enter="load">
      <select v-model="vis" class="ip !w-auto" @change="load"><option value="">Mọi chế độ xem</option><option value="public">Công khai</option><option value="friends">Bạn bè</option><option value="private">Riêng tư</option></select>
      <select v-model.number="days" class="ip !w-auto" @change="load"><option :value="7">7 ngày</option><option :value="30">30 ngày</option><option :value="90">90 ngày</option><option :value="0">Tất cả</option></select>
      <button type="button" class="btn !h-8" :disabled="busy" @click="load">{{ busy ? 'Đang tải…' : 'Lọc' }}</button>
    </div>
    <div class="text-xs text-mute">{{ items.length }} điểm<span v-if="total>items.length"> (khớp {{ total }}, hiển thị tối đa 1000)</span> · 🟢 Công khai · 🔵 Bạn bè · ⚪ Riêng tư</div>
  </div>
  <div v-if="err" class="card p-4 text-center" style="color:#c0392b">{{ err }}</div>
  <div class="card" style="overflow:hidden"><div ref="mapEl" style="height:340px;width:100%"></div></div>
  <div v-if="!busy && !items.length && !err" class="card p-6 text-center text-mute">Không có check-in nào khớp bộ lọc.</div>
  <div v-else-if="items.length" class="card">
    <div v-for="it in items" :key="it.postId" class="p-3 flex gap-2 items-start border-b border-line" :style="sel===it.postId?'background:rgba(44,98,158,.08)':''">
      <div class="min-w-0" style="flex:1;cursor:pointer" @click="pick(it)">
        <div class="text-sm font-bold truncate">{{ it.name }} <span class="text-xs text-mute" style="font-weight:400">· {{ VLAB[it.visibility] || it.visibility }} · {{ ago(it.createdAt) }}</span></div>
        <div class="text-sm">📍 {{ it.location.name }}</div>
        <div v-if="it.text" class="text-xs text-mute truncate">{{ it.text }}</div>
      </div>
      <div class="flex flex-col gap-1" style="flex-shrink:0">
        <button type="button" class="btn !h-7 !text-xs !bg-transparent !text-zb2 border border-line" :disabled="mbusy===it.postId" @click="clearLoc(it)">Gỡ vị trí</button>
        <button type="button" class="btn !h-7 !text-xs !bg-transparent border border-line" style="color:#c0392b" :disabled="mbusy===it.postId" @click="delPost(it)">Xóa bài</button>
      </div>
    </div>
  </div>
</div>`,
};
export { CMap, AdminMap };
