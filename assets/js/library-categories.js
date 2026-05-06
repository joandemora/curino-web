// assets/js/library-categories.js
//
// Set canónico de categorías y subcategorías del marketplace de Curino.
// Compartido entre /cuenta/vendedor/dibujos/ (gestión seller) y
// /configurador-2d/ (visualización en BIBLIOTECA).
//
// IMPORTANTE: las RPCs y la Edge Function publish-library-item validan
// contra estos slugs. Mantener sincronizados los 3 sitios:
//   - este archivo
//   - supabase/functions/publish-library-item/index.ts (SUBCATEGORIES_BY_CATEGORY)
//   - SQL: update_library_item_subcategory + update_library_item_category (case ... when)

window.LibraryCategories = (function() {
  // Orden de categorías para el render del panel BIBLIOTECA.
  const CATEGORIES = [
    { key: 'asientos',        label: 'Asientos' },
    { key: 'mesas',           label: 'Mesas' },
    { key: 'almacenamiento',  label: 'Almacenamiento' },
    { key: 'iluminacion',     label: 'Iluminación' },
    { key: 'decoracion',      label: 'Decoración' },
    { key: 'exterior',        label: 'Exterior' },
    { key: 'otros',           label: 'Otros' }
  ];

  // Subcategorías permitidas por categoría, en orden.
  const SUBCATEGORIES_BY_CATEGORY = {
    asientos:       ['sofas', 'sillas', 'butacas', 'taburetes'],
    mesas:          ['mesa-comedor', 'mesa-centro', 'escritorio', 'mesilla'],
    almacenamiento: ['estanteria', 'armario', 'cajonera', 'vitrina'],
    iluminacion:    ['lampara-techo', 'lampara-mesa', 'lampara-pie'],
    decoracion:     ['cuadros', 'jarrones', 'espejos', 'plantas'],
    exterior:       ['silla-exterior', 'mesa-exterior', 'parasol', 'jardineras'],
    otros:          ['otros']
  };

  // Labels de subcategorías para mostrar al user (con tildes y "de").
  const SUBCATEGORY_LABELS = {
    sofas: 'Sofás',
    sillas: 'Sillas',
    butacas: 'Butacas',
    taburetes: 'Taburetes',
    'mesa-comedor': 'Mesa de comedor',
    'mesa-centro': 'Mesa de centro',
    escritorio: 'Escritorio',
    mesilla: 'Mesilla',
    estanteria: 'Estantería',
    armario: 'Armario',
    cajonera: 'Cajonera',
    vitrina: 'Vitrina',
    'lampara-techo': 'Lámpara de techo',
    'lampara-mesa': 'Lámpara de mesa',
    'lampara-pie': 'Lámpara de pie',
    cuadros: 'Cuadros',
    jarrones: 'Jarrones',
    espejos: 'Espejos',
    plantas: 'Plantas',
    'silla-exterior': 'Silla de exterior',
    'mesa-exterior': 'Mesa de exterior',
    parasol: 'Parasol',
    jardineras: 'Jardineras',
    otros: 'Otros'
  };

  function categoryLabel(key) {
    const cat = CATEGORIES.find(c => c.key === key);
    return cat ? cat.label : key;
  }

  function subcategoryLabel(key) {
    return SUBCATEGORY_LABELS[key] || key;
  }

  function isValidCategory(key) {
    return CATEGORIES.some(c => c.key === key);
  }

  function isValidSubcategory(category, subcategory) {
    const subs = SUBCATEGORIES_BY_CATEGORY[category];
    return subs ? subs.includes(subcategory) : false;
  }

  return {
    CATEGORIES,
    SUBCATEGORIES_BY_CATEGORY,
    SUBCATEGORY_LABELS,
    categoryLabel,
    subcategoryLabel,
    isValidCategory,
    isValidSubcategory
  };
})();
