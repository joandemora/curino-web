/* ============================================================
 * cp-data.js — capa de acceso a Supabase para Carpintería
 *
 * Wrapper alrededor de window.__ashSupabase (cliente expuesto por
 * initAdminShell). Centraliza CRUD + queries de carga completa de
 * un proyecto (project + furnitures + panels + edges + ops + hw)
 * para que cp-bom + cp-budget puedan trabajar offline en memoria.
 *
 * Multi-tenant: el owner_id de las tablas raíz se rellena con el
 * uuid del usuario logueado en cada INSERT.
 *
 * Devuelve siempre {data, error} (mismo shape que supabase-js).
 * ============================================================ */
(function (global) {
  'use strict';

  function supa() {
    var s = global.__ashSupabase;
    if (!s) throw new Error('cp-data: window.__ashSupabase no inicializado. Llama initAdminShell antes.');
    return s;
  }
  function ownerId() {
    var u = global.__ashUser;
    if (!u || !u.id) throw new Error('cp-data: window.__ashUser no inicializado.');
    return u.id;
  }

  // ── COST_CONFIG (singleton por owner) ─────────────────────────
  async function getCostConfig() {
    var r = await supa().from('carpinteria_cost_config')
      .select('*').eq('owner_id', ownerId()).maybeSingle();
    return r;
  }
  // Upsert porque PK = owner_id; si no existe, crea.
  async function saveCostConfig(payload) {
    var row = Object.assign({}, payload, {
      owner_id: ownerId(),
      updated_at: new Date().toISOString(),
      updated_by: ownerId()
    });
    return supa().from('carpinteria_cost_config').upsert(row, { onConflict: 'owner_id' }).select('*').single();
  }

  // ── CLIENTS ───────────────────────────────────────────────────
  async function listClients() {
    return supa().from('carpinteria_clients').select('*').eq('owner_id', ownerId()).order('name');
  }
  async function createClient(payload) {
    var row = Object.assign({}, payload, { owner_id: ownerId() });
    return supa().from('carpinteria_clients').insert(row).select('*').single();
  }
  async function updateClient(id, patch) {
    return supa().from('carpinteria_clients').update(patch).eq('id', id).select('*').single();
  }
  async function deleteClient(id) {
    return supa().from('carpinteria_clients').delete().eq('id', id);
  }

  // ── MATERIALS ─────────────────────────────────────────────────
  async function listMaterials(opts) {
    opts = opts || {};
    var q = supa().from('carpinteria_materials').select('*').eq('owner_id', ownerId());
    if (opts.type) q = q.eq('type', opts.type);
    if (opts.activeOnly !== false) q = q.eq('active', true);
    return q.order('name');
  }
  async function createMaterial(payload) {
    var row = Object.assign({}, payload, { owner_id: ownerId() });
    return supa().from('carpinteria_materials').insert(row).select('*').single();
  }
  async function updateMaterial(id, patch) {
    return supa().from('carpinteria_materials').update(patch).eq('id', id).select('*').single();
  }
  async function deleteMaterial(id) {
    return supa().from('carpinteria_materials').delete().eq('id', id);
  }

  // ── MATERIAL_BOARD_SIZES ──────────────────────────────────────
  async function listBoardSizes(materialId) {
    return supa().from('carpinteria_material_board_sizes')
      .select('*').eq('material_id', materialId).eq('active', true)
      .order('sort_order');
  }
  async function createBoardSize(payload) {
    return supa().from('carpinteria_material_board_sizes').insert(payload).select('*').single();
  }
  async function updateBoardSize(id, patch) {
    return supa().from('carpinteria_material_board_sizes').update(patch).eq('id', id).select('*').single();
  }
  async function deleteBoardSize(id) {
    return supa().from('carpinteria_material_board_sizes').delete().eq('id', id);
  }

  // ── HARDWARE ──────────────────────────────────────────────────
  async function listHardware(opts) {
    opts = opts || {};
    var q = supa().from('carpinteria_hardware').select('*').eq('owner_id', ownerId());
    if (opts.activeOnly !== false) q = q.eq('active', true);
    return q.order('name');
  }
  async function createHardware(payload) {
    var row = Object.assign({}, payload, { owner_id: ownerId() });
    return supa().from('carpinteria_hardware').insert(row).select('*').single();
  }
  async function updateHardware(id, patch) {
    return supa().from('carpinteria_hardware').update(patch).eq('id', id).select('*').single();
  }
  async function deleteHardware(id) {
    return supa().from('carpinteria_hardware').delete().eq('id', id);
  }

  // ── PROJECTS ──────────────────────────────────────────────────
  async function listProjects() {
    return supa().from('carpinteria_projects')
      .select('*, client:carpinteria_clients(id,name)')
      .eq('owner_id', ownerId())
      .order('created_at', { ascending: false });
  }
  async function getProject(id) {
    return supa().from('carpinteria_projects')
      .select('*, client:carpinteria_clients(id,name,email,phone)')
      .eq('id', id).maybeSingle();
  }
  // Crea proyecto snapshoteando tarifas del cost_config (si existe).
  // Si no existe, usa defaults razonables.
  async function createProject(payload) {
    var cfgRes = await getCostConfig();
    var cfg = cfgRes.data || {};
    var row = Object.assign({
      margin_percent: cfg.default_margin_percent != null ? cfg.default_margin_percent : 30.00,
      vat_percent:    cfg.default_vat_percent    != null ? cfg.default_vat_percent    : 21.00,
      rate_cut_per_ml_eur:       cfg.default_rate_cut_per_ml_eur != null ? cfg.default_rate_cut_per_ml_eur : 0.00,
      rate_edge_band_per_ml_eur: cfg.default_rate_edge_band_per_ml_eur != null ? cfg.default_rate_edge_band_per_ml_eur : 0.00,
      kerf_mm:        cfg.default_kerf_mm        != null ? cfg.default_kerf_mm        : 4.0,
      border_trim_mm: cfg.default_border_trim_mm != null ? cfg.default_border_trim_mm : 10.0
    }, payload, { owner_id: ownerId() });
    return supa().from('carpinteria_projects').insert(row).select('*').single();
  }
  async function updateProject(id, patch) {
    return supa().from('carpinteria_projects').update(patch).eq('id', id).select('*').single();
  }
  async function deleteProject(id) {
    return supa().from('carpinteria_projects').delete().eq('id', id);
  }

  // ── FURNITURES ────────────────────────────────────────────────
  async function listFurnitures(projectId) {
    return supa().from('carpinteria_furnitures').select('*')
      .eq('project_id', projectId).order('sort_order');
  }
  async function createFurniture(payload) {
    return supa().from('carpinteria_furnitures').insert(payload).select('*').single();
  }
  async function updateFurniture(id, patch) {
    return supa().from('carpinteria_furnitures').update(patch).eq('id', id).select('*').single();
  }
  async function deleteFurniture(id) {
    return supa().from('carpinteria_furnitures').delete().eq('id', id);
  }

  // ── PANELS ────────────────────────────────────────────────────
  async function listPanels(furnitureId) {
    return supa().from('carpinteria_panels').select('*')
      .eq('furniture_id', furnitureId).order('sort_order');
  }
  async function createPanel(payload) {
    return supa().from('carpinteria_panels').insert(payload).select('*').single();
  }
  async function updatePanel(id, patch) {
    return supa().from('carpinteria_panels').update(patch).eq('id', id).select('*').single();
  }
  async function deletePanel(id) {
    return supa().from('carpinteria_panels').delete().eq('id', id);
  }

  // ── PANEL EDGES ───────────────────────────────────────────────
  async function listEdges(panelId) {
    return supa().from('carpinteria_panel_edges').select('*').eq('panel_id', panelId);
  }
  async function upsertEdge(payload) {
    // payload = { panel_id, edge, edge_material_id }
    return supa().from('carpinteria_panel_edges')
      .upsert(payload, { onConflict: 'panel_id,edge' })
      .select('*').single();
  }
  async function deleteEdge(panelId, edge) {
    return supa().from('carpinteria_panel_edges').delete()
      .eq('panel_id', panelId).eq('edge', edge);
  }

  // ── PANEL OPERATIONS ──────────────────────────────────────────
  async function listOps(panelId) {
    return supa().from('carpinteria_panel_operations').select('*')
      .eq('panel_id', panelId).order('sort_order');
  }
  async function createOp(payload) {
    return supa().from('carpinteria_panel_operations').insert(payload).select('*').single();
  }
  async function updateOp(id, patch) {
    return supa().from('carpinteria_panel_operations').update(patch).eq('id', id).select('*').single();
  }
  async function deleteOp(id) {
    return supa().from('carpinteria_panel_operations').delete().eq('id', id);
  }

  // ── FURNITURE HARDWARE ────────────────────────────────────────
  async function listFurnitureHardware(furnitureId) {
    return supa().from('carpinteria_furniture_hardware').select('*')
      .eq('furniture_id', furnitureId);
  }
  async function upsertFurnitureHardware(payload) {
    return supa().from('carpinteria_furniture_hardware')
      .upsert(payload, { onConflict: 'furniture_id,hardware_id' })
      .select('*').single();
  }
  async function deleteFurnitureHardware(id) {
    return supa().from('carpinteria_furniture_hardware').delete().eq('id', id);
  }

  // ── CARGA COMPLETA del proyecto (para BOM / presupuesto) ──────
  // Devuelve la estructura jerárquica que cp-bom.compute() espera.
  async function loadFullProject(projectId) {
    var projRes = await getProject(projectId);
    if (projRes.error || !projRes.data) return { error: projRes.error || new Error('project_not_found') };
    var project = projRes.data;

    var [furRes, matsRes, hwsRes] = await Promise.all([
      listFurnitures(projectId),
      supa().from('carpinteria_materials').select('*').eq('owner_id', ownerId()),
      supa().from('carpinteria_hardware').select('*').eq('owner_id', ownerId())
    ]);
    if (furRes.error)  return { error: furRes.error };
    if (matsRes.error) return { error: matsRes.error };
    if (hwsRes.error)  return { error: hwsRes.error };
    var furnitures = furRes.data || [];
    var materials  = matsRes.data || [];
    var hardware   = hwsRes.data || [];

    // Cargar panels / edges / ops / fh para cada furniture en paralelo
    var perFurniture = await Promise.all(furnitures.map(async function (f) {
      var pansRes = await listPanels(f.id);
      var pans = (pansRes.data || []);
      var hwRes = await listFurnitureHardware(f.id);
      var perPanel = await Promise.all(pans.map(async function (pn) {
        var [eRes, oRes] = await Promise.all([listEdges(pn.id), listOps(pn.id)]);
        return { panel: pn, edges: eRes.data || [], ops: oRes.data || [] };
      }));
      return { furniture: f, panels: perPanel, hardware: hwRes.data || [] };
    }));

    var panelsByFurniture = {};
    var edgesByPanel = {};
    var opsByPanel = {};
    var furnitureHardwareByFurniture = {};
    perFurniture.forEach(function (entry) {
      panelsByFurniture[entry.furniture.id] = entry.panels.map(function (x) { return x.panel; });
      entry.panels.forEach(function (x) {
        edgesByPanel[x.panel.id] = x.edges;
        opsByPanel[x.panel.id] = x.ops;
      });
      furnitureHardwareByFurniture[entry.furniture.id] = entry.hardware;
    });

    return {
      data: {
        project: project,
        furnitures: furnitures,
        panelsByFurniture: panelsByFurniture,
        edgesByPanel: edgesByPanel,
        opsByPanel: opsByPanel,
        furnitureHardwareByFurniture: furnitureHardwareByFurniture,
        materials: materials,
        hardware: hardware
      }
    };
  }

  // ── Expose ────────────────────────────────────────────────────
  global.CpData = {
    // config
    getCostConfig: getCostConfig, saveCostConfig: saveCostConfig,
    // clients
    listClients: listClients, createClient: createClient,
    updateClient: updateClient, deleteClient: deleteClient,
    // materials
    listMaterials: listMaterials, createMaterial: createMaterial,
    updateMaterial: updateMaterial, deleteMaterial: deleteMaterial,
    // board sizes
    listBoardSizes: listBoardSizes, createBoardSize: createBoardSize,
    updateBoardSize: updateBoardSize, deleteBoardSize: deleteBoardSize,
    // hardware
    listHardware: listHardware, createHardware: createHardware,
    updateHardware: updateHardware, deleteHardware: deleteHardware,
    // projects
    listProjects: listProjects, getProject: getProject,
    createProject: createProject, updateProject: updateProject,
    deleteProject: deleteProject,
    // furnitures
    listFurnitures: listFurnitures, createFurniture: createFurniture,
    updateFurniture: updateFurniture, deleteFurniture: deleteFurniture,
    // panels
    listPanels: listPanels, createPanel: createPanel,
    updatePanel: updatePanel, deletePanel: deletePanel,
    // edges
    listEdges: listEdges, upsertEdge: upsertEdge, deleteEdge: deleteEdge,
    // ops
    listOps: listOps, createOp: createOp, updateOp: updateOp, deleteOp: deleteOp,
    // furniture hardware
    listFurnitureHardware: listFurnitureHardware,
    upsertFurnitureHardware: upsertFurnitureHardware,
    deleteFurnitureHardware: deleteFurnitureHardware,
    // bulk
    loadFullProject: loadFullProject
  };
})(typeof window !== 'undefined' ? window : globalThis);
