/* CarePlus seed data — role-based medicine availability & transfer coordination */
(function () {
  "use strict";

  const medicines = [
    { id: "m_para", name: "Paracetamol 500 mg", form: "Tablet", unit: "tablet", category: "Analgesic" },
    { id: "m_amox", name: "Amoxicillin 500 mg", form: "Capsule", unit: "capsule", category: "Antibiotic" },
    { id: "m_insu", name: "Insulin (Human) 40 IU", form: "Vial", unit: "vial", category: "Antidiabetic" },
    { id: "m_ors",  name: "ORS Sachet", form: "Sachet", unit: "sachet", category: "Rehydration" },
    { id: "m_metf", name: "Metformin 500 mg", form: "Tablet", unit: "tablet", category: "Antidiabetic" },
    { id: "m_ceti", name: "Cetirizine 10 mg", form: "Tablet", unit: "tablet", category: "Antihistamine" },
    { id: "m_amlo", name: "Amlodipine 5 mg", form: "Tablet", unit: "tablet", category: "Antihypertensive" },
    { id: "m_salb", name: "Salbutamol Inhaler", form: "Inhaler", unit: "inhaler", category: "Bronchodilator" },
    { id: "m_azi",  name: "Azithromycin 250 mg", form: "Tablet", unit: "tablet", category: "Antibiotic" },
    { id: "m_ns",   name: "Normal Saline 500 ml", form: "Bag", unit: "bag", category: "IV Fluid" }
  ];

  const centres = [
    { id: "C1", name: "Green Valley PHC", area: "Green Valley", distanceKm: 2.1, phone: "+91 90000 11001", incharge: "Dr. A. Menon" },
    { id: "C2", name: "Riverside PHC", area: "Riverside", distanceKm: 3.6, phone: "+91 90000 11002", incharge: "Dr. S. Rao" },
    { id: "C3", name: "Hilltop PHC", area: "Hilltop", distanceKm: 5.2, phone: "+91 90000 11003", incharge: "Dr. P. Nair" },
    { id: "C4", name: "Sunrise PHC", area: "Sunrise Colony", distanceKm: 6.8, phone: "+91 90000 11004", incharge: "Dr. K. Iyer" }
  ];

  const suppliers = [
    { id: "S1", name: "MediDist Ltd", contact: "+91 98800 22001", rating: 4.6, leadTimeDays: 3 },
    { id: "S2", name: "PharmaLink Distributors", contact: "+91 98800 22002", rating: 4.2, leadTimeDays: 4 },
    { id: "S3", name: "HealthCore Supplies", contact: "+91 98800 22003", rating: 4.8, leadTimeDays: 5 }
  ];

  const customers = [
    { id: "cust1", name: "Ravi Kumar", phone: "+91 98111 33001", area: "Green Valley" },
    { id: "cust2", name: "Meera Joseph", phone: "+91 98111 33002", area: "Sunrise Colony" },
    { id: "cust3", name: "Arun Das", phone: "+91 98111 33003", area: "Riverside" }
  ];

  /* Per-centre inventory.
     qty      = current stock on hand
     daily    = average daily consumption
     safety   = safety stock (minimum quantity the centre should hold)
     lead     = supplier lead time in days
  */
  const stock = {
    C1: {
      m_para: { qty: 40,  daily: 30, safety: 120, lead: 3 },
      m_amox: { qty: 400, daily: 20, safety: 90,  lead: 4 },
      m_insu: { qty: 12,  daily: 3,  safety: 30,  lead: 5 },
      m_ors:  { qty: 220, daily: 15, safety: 80,  lead: 2 },
      m_metf: { qty: 300, daily: 12, safety: 90,  lead: 4 },
      m_ceti: { qty: 180, daily: 8,  safety: 60,  lead: 3 },
      m_amlo: { qty: 90,  daily: 10, safety: 100, lead: 5 },
      m_salb: { qty: 35,  daily: 2,  safety: 20,  lead: 6 },
      m_azi:  { qty: 60,  daily: 9,  safety: 100, lead: 4 },
      m_ns:   { qty: 150, daily: 10, safety: 60,  lead: 3 }
    },
    C2: {
      m_para: { qty: 500, daily: 20, safety: 100, lead: 3 },
      m_amox: { qty: 120, daily: 18, safety: 80,  lead: 4 },
      m_insu: { qty: 30,  daily: 2,  safety: 24,  lead: 5 },
      m_ors:  { qty: 400, daily: 12, safety: 70,  lead: 2 },
      m_metf: { qty: 150, daily: 14, safety: 90,  lead: 4 },
      m_ceti: { qty: 70,  daily: 9,  safety: 60,  lead: 3 },
      m_amlo: { qty: 220, daily: 8,  safety: 90,  lead: 5 },
      m_salb: { qty: 20,  daily: 3,  safety: 24,  lead: 6 },
      m_azi:  { qty: 300, daily: 8,  safety: 100, lead: 4 },
      m_ns:   { qty: 90,  daily: 12, safety: 70,  lead: 3 }
    },
    C3: {
      m_para: { qty: 180, daily: 25, safety: 120, lead: 3 },
      m_amox: { qty: 60,  daily: 25, safety: 100, lead: 4 },
      m_insu: { qty: 40,  daily: 3,  safety: 30,  lead: 5 },
      m_ors:  { qty: 60,  daily: 14, safety: 70,  lead: 2 },
      m_metf: { qty: 400, daily: 10, safety: 90,  lead: 4 },
      m_ceti: { qty: 40,  daily: 9,  safety: 60,  lead: 3 },
      m_amlo: { qty: 260, daily: 6,  safety: 80,  lead: 5 },
      m_salb: { qty: 45,  daily: 2,  safety: 24,  lead: 6 },
      m_azi:  { qty: 50,  daily: 10, safety: 100, lead: 4 },
      m_ns:   { qty: 200, daily: 8,  safety: 60,  lead: 3 }
    },
    C4: {
      m_para: { qty: 260, daily: 18, safety: 100, lead: 3 },
      m_amox: { qty: 200, daily: 15, safety: 80,  lead: 4 },
      m_insu: { qty: 18,  daily: 2,  safety: 24,  lead: 5 },
      m_ors:  { qty: 30,  daily: 16, safety: 80,  lead: 2 },
      m_metf: { qty: 120, daily: 15, safety: 90,  lead: 4 },
      m_ceti: { qty: 100, daily: 7,  safety: 60,  lead: 3 },
      m_amlo: { qty: 60,  daily: 9,  safety: 100, lead: 5 },
      m_salb: { qty: 30,  daily: 3,  safety: 24,  lead: 6 },
      m_azi:  { qty: 130, daily: 9,  safety: 100, lead: 4 },
      m_ns:   { qty: 40,  daily: 10, safety: 70,  lead: 3 }
    }
  };

  /* Customer medicine requests sent to a PHC.
     status: pending | accepted | partial | out_of_stock | fulfilled
  */
  const customerRequests = [
    {
      id: "CR-1042", customerId: "cust1", centreId: "C1", medId: "m_para", qty: 20,
      prescription: true, prescriptionName: "prescription_ravi.jpg",
      status: "pending", createdAt: "2026-10-09 09:12", responseNote: "",
      events: [{ time: "2026-10-09 09:12", text: "Request sent to Green Valley PHC" }]
    },
    {
      id: "CR-1041", customerId: "cust2", centreId: "C4", medId: "m_insu", qty: 2,
      prescription: true, prescriptionName: "prescription_meera.pdf",
      status: "accepted", createdAt: "2026-10-08 16:40", responseNote: "Stock available. Please carry ID.",
      events: [
        { time: "2026-10-08 16:40", text: "Request sent to Sunrise PHC" },
        { time: "2026-10-08 17:05", text: "PHC accepted: stock available" }
      ]
    },
    {
      id: "CR-1040", customerId: "cust3", centreId: "C2", medId: "m_ors", qty: 5,
      prescription: false, prescriptionName: "",
      status: "fulfilled", createdAt: "2026-10-07 11:20", responseNote: "Collected from Riverside PHC.",
      events: [
        { time: "2026-10-07 11:20", text: "Request sent to Riverside PHC" },
        { time: "2026-10-07 11:45", text: "PHC accepted: stock available" },
        { time: "2026-10-07 15:10", text: "Marked fulfilled after pickup" }
      ]
    }
  ];

  /* PHC → supplier supply requests.
     status: pending | accepted | rejected | partial | dispatched | delivered
  */
  const supplyRequests = [
    {
      id: "SR-2007", centreId: "C2", supplierId: "S1", medId: "m_para", qty: 200,
      status: "accepted", eta: "2026-10-11", dispatchedQty: 0,
      note: "Bulk refill after district review.",
      events: [
        { time: "2026-10-08 10:00", text: "Supply request raised to MediDist Ltd" },
        { time: "2026-10-08 13:30", text: "MediDist Ltd accepted, expected 2026-10-11" }
      ]
    },
    {
      id: "SR-2006", centreId: "C3", supplierId: "S2", medId: "m_azi", qty: 100,
      status: "pending", eta: "", dispatchedQty: 0,
      note: "Azithromycin running low for OPD.",
      events: [{ time: "2026-10-09 08:15", text: "Supply request raised to PharmaLink Distributors" }]
    },
    {
      id: "SR-2005", centreId: "C4", supplierId: "S2", medId: "m_ors", qty: 50,
      status: "partial", eta: "2026-10-12", dispatchedQty: 30,
      note: "Seasonal demand spike.",
      events: [
        { time: "2026-10-06 09:00", text: "Supply request raised to PharmaLink Distributors" },
        { time: "2026-10-06 15:20", text: "PharmaLink partially fulfilled 30 of 50, balance later" }
      ]
    }
  ];

  /* Transfer proposals already approved by a PHC (audit trail). */
  const transfers = [];

  const SEED = {
    medicines,
    centres,
    suppliers,
    customers,
    stock,
    customerRequests,
    supplyRequests,
    transfers,
    currentCustomerId: "cust1",
    currentCentreId: "C1"
  };

  if (typeof module !== "undefined" && module.exports) module.exports = SEED;
  if (typeof window !== "undefined") window.CP_SEED = SEED;
})();
