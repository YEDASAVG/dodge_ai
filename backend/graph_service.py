"""
NetworkX graph construction from SQLite O2C data.

7 node types (headers/master only):
  SalesOrder, Delivery, BillingDocument, JournalEntry, Customer, Product, Plant

Items (order_items, delivery_items, billing_items) become edge metadata,
not standalone nodes.
"""

import sqlite3
from typing import Any

import networkx as nx

from config import DB_PATH


def _db_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return dict(row)


def build_graph(db_path=None) -> nx.DiGraph:
    """Build the full O2C graph from SQLite data."""
    conn = _db_conn() if db_path is None else sqlite3.connect(str(db_path))
    if db_path:
        conn.row_factory = sqlite3.Row
    G = nx.DiGraph()

    # ------------------------------------------------------------------
    # 1. Add nodes — 7 types
    # ------------------------------------------------------------------

    # Sales Orders
    for r in conn.execute("SELECT * FROM sales_order_headers").fetchall():
        d = _row_to_dict(r)
        G.add_node(f"SalesOrder:{d['salesOrder']}", type="SalesOrder", label=d["salesOrder"], **d)

    # Outbound Deliveries
    for r in conn.execute("SELECT * FROM outbound_delivery_headers").fetchall():
        d = _row_to_dict(r)
        G.add_node(f"Delivery:{d['deliveryDocument']}", type="Delivery", label=d["deliveryDocument"], **d)

    # Billing Documents
    for r in conn.execute("SELECT * FROM billing_document_headers").fetchall():
        d = _row_to_dict(r)
        G.add_node(f"BillingDocument:{d['billingDocument']}", type="BillingDocument", label=d["billingDocument"], **d)

    # Journal Entries (AR)
    for r in conn.execute("SELECT * FROM journal_entry_items_accounts_receivable").fetchall():
        d = _row_to_dict(r)
        node_id = f"JournalEntry:{d['companyCode']}:{d['fiscalYear']}:{d['accountingDocument']}"
        # Augment with payment data if available
        pay = conn.execute(
            """SELECT invoiceReference, salesDocument, salesDocumentItem
               FROM payments_accounts_receivable
               WHERE companyCode=? AND fiscalYear=? AND accountingDocument=?""",
            (d["companyCode"], d["fiscalYear"], d["accountingDocument"]),
        ).fetchone()
        if pay:
            d["pay_invoiceReference"] = pay["invoiceReference"]
            d["pay_salesDocument"] = pay["salesDocument"]
            d["pay_salesDocumentItem"] = pay["salesDocumentItem"]
        G.add_node(node_id, type="JournalEntry", label=d["accountingDocument"], **d)

    # Customers (Business Partners)
    for r in conn.execute("SELECT * FROM business_partners").fetchall():
        d = _row_to_dict(r)
        G.add_node(f"Customer:{d['businessPartner']}", type="Customer", label=d.get("businessPartnerFullName", d["businessPartner"]), **d)

    # Products
    for r in conn.execute("SELECT * FROM products").fetchall():
        d = _row_to_dict(r)
        # Attach description
        desc = conn.execute(
            "SELECT productDescription FROM product_descriptions WHERE product=? AND language='EN'",
            (d["product"],),
        ).fetchone()
        if desc:
            d["productDescription"] = desc["productDescription"]
        G.add_node(f"Product:{d['product']}", type="Product", label=d.get("productDescription", d["product"]) if desc else d["product"], **d)

    # Plants
    for r in conn.execute("SELECT * FROM plants").fetchall():
        d = _row_to_dict(r)
        G.add_node(f"Plant:{d['plant']}", type="Plant", label=d.get("plantName", d["plant"]), **d)

    # ------------------------------------------------------------------
    # 2. Add edges
    # ------------------------------------------------------------------

    # SO → Customer (soldToParty)
    for r in conn.execute("SELECT salesOrder, soldToParty FROM sales_order_headers WHERE soldToParty IS NOT NULL AND soldToParty != ''").fetchall():
        so_node = f"SalesOrder:{r['salesOrder']}"
        cust_node = f"Customer:{r['soldToParty']}"
        if G.has_node(cust_node):
            G.add_edge(so_node, cust_node, relation="soldToParty")

    # SO → Product (via order items)
    for r in conn.execute("SELECT DISTINCT salesOrder, material FROM sales_order_items WHERE material IS NOT NULL AND material != ''").fetchall():
        so_node = f"SalesOrder:{r['salesOrder']}"
        prod_node = f"Product:{r['material']}"
        if G.has_node(prod_node):
            G.add_edge(so_node, prod_node, relation="orderedProduct")

    # SO → Plant (via order items)
    for r in conn.execute("SELECT DISTINCT salesOrder, productionPlant FROM sales_order_items WHERE productionPlant IS NOT NULL AND productionPlant != ''").fetchall():
        so_node = f"SalesOrder:{r['salesOrder']}"
        plant_node = f"Plant:{r['productionPlant']}"
        if G.has_node(plant_node):
            G.add_edge(so_node, plant_node, relation="productionPlant")

    # SO → Delivery (INDIRECT via delivery_items.referenceSdDocument)
    for r in conn.execute("""
        SELECT DISTINCT di.referenceSdDocument AS salesOrder, dh.deliveryDocument
        FROM outbound_delivery_items di
        JOIN outbound_delivery_headers dh ON di.deliveryDocument = dh.deliveryDocument
        WHERE di.referenceSdDocument IS NOT NULL AND di.referenceSdDocument != ''
    """).fetchall():
        so_node = f"SalesOrder:{r['salesOrder']}"
        del_node = f"Delivery:{r['deliveryDocument']}"
        if G.has_node(so_node) and G.has_node(del_node):
            G.add_edge(so_node, del_node, relation="hasDelivery")

    # Delivery → Plant (via delivery items)
    for r in conn.execute("""
        SELECT DISTINCT deliveryDocument, plant
        FROM outbound_delivery_items
        WHERE plant IS NOT NULL AND plant != ''
    """).fetchall():
        del_node = f"Delivery:{r['deliveryDocument']}"
        plant_node = f"Plant:{r['plant']}"
        if G.has_node(del_node) and G.has_node(plant_node):
            G.add_edge(del_node, plant_node, relation="deliveryPlant")

    # Delivery → BillingDoc (INDIRECT via billing_items.referenceSdDocument)
    for r in conn.execute("""
        SELECT DISTINCT bi.referenceSdDocument AS deliveryDocument, bh.billingDocument
        FROM billing_document_items bi
        JOIN billing_document_headers bh ON bi.billingDocument = bh.billingDocument
        WHERE bi.referenceSdDocument IS NOT NULL AND bi.referenceSdDocument != ''
    """).fetchall():
        del_node = f"Delivery:{r['deliveryDocument']}"
        bill_node = f"BillingDocument:{r['billingDocument']}"
        if G.has_node(del_node) and G.has_node(bill_node):
            G.add_edge(del_node, bill_node, relation="hasBilling")

    # BillingDoc → Customer (soldToParty)
    for r in conn.execute("SELECT billingDocument, soldToParty FROM billing_document_headers WHERE soldToParty IS NOT NULL AND soldToParty != ''").fetchall():
        bill_node = f"BillingDocument:{r['billingDocument']}"
        cust_node = f"Customer:{r['soldToParty']}"
        if G.has_node(cust_node):
            G.add_edge(bill_node, cust_node, relation="billedTo")

    # BillingDoc → Product (via billing items)
    for r in conn.execute("SELECT DISTINCT billingDocument, material FROM billing_document_items WHERE material IS NOT NULL AND material != ''").fetchall():
        bill_node = f"BillingDocument:{r['billingDocument']}"
        prod_node = f"Product:{r['material']}"
        if G.has_node(prod_node):
            G.add_edge(bill_node, prod_node, relation="billedProduct")

    # BillingDoc → JournalEntry (3-field composite FK)
    for r in conn.execute("""
        SELECT billingDocument, companyCode, fiscalYear, accountingDocument
        FROM billing_document_headers
        WHERE accountingDocument IS NOT NULL AND accountingDocument != ''
    """).fetchall():
        bill_node = f"BillingDocument:{r['billingDocument']}"
        je_node = f"JournalEntry:{r['companyCode']}:{r['fiscalYear']}:{r['accountingDocument']}"
        if G.has_node(je_node):
            G.add_edge(bill_node, je_node, relation="hasJournalEntry")

    # JournalEntry → Customer
    for r in conn.execute("""
        SELECT companyCode, fiscalYear, accountingDocument, customer
        FROM journal_entry_items_accounts_receivable
        WHERE customer IS NOT NULL AND customer != ''
    """).fetchall():
        je_node = f"JournalEntry:{r['companyCode']}:{r['fiscalYear']}:{r['accountingDocument']}"
        cust_node = f"Customer:{r['customer']}"
        if G.has_node(cust_node):
            G.add_edge(je_node, cust_node, relation="journalCustomer")

    conn.close()
    return G


# ------------------------------------------------------------------
# Query helpers
# ------------------------------------------------------------------

def get_node(G: nx.DiGraph, node_id: str) -> dict | None:
    """Get full metadata for a node."""
    if node_id not in G:
        return None
    data = dict(G.nodes[node_id])
    data["id"] = node_id
    data["connections"] = G.degree(node_id)
    return data


def get_neighbors(G: nx.DiGraph, node_id: str, depth: int = 1) -> dict:
    """Get neighbors up to N hops. Returns {nodes: [...], edges: [...]}."""
    if node_id not in G:
        return {"nodes": [], "edges": []}

    visited_nodes = set()
    edges = []
    frontier = {node_id}

    for _ in range(depth):
        next_frontier = set()
        for n in frontier:
            visited_nodes.add(n)
            # Successors (outgoing)
            for succ in G.successors(n):
                if succ not in visited_nodes:
                    next_frontier.add(succ)
                    edges.append({"source": n, "target": succ, "relation": G.edges[n, succ].get("relation", "")})
            # Predecessors (incoming)
            for pred in G.predecessors(n):
                if pred not in visited_nodes:
                    next_frontier.add(pred)
                    edges.append({"source": pred, "target": n, "relation": G.edges[pred, n].get("relation", "")})
        frontier = next_frontier

    visited_nodes.update(frontier)
    nodes = []
    for nid in visited_nodes:
        nd = dict(G.nodes[nid])
        nd["id"] = nid
        nd["connections"] = G.degree(nid)
        nodes.append(nd)

    return {"nodes": nodes, "edges": edges}


def get_summary(G: nx.DiGraph) -> dict:
    """Node and edge counts by type."""
    node_counts: dict[str, int] = {}
    for _, data in G.nodes(data=True):
        t = data.get("type", "unknown")
        node_counts[t] = node_counts.get(t, 0) + 1

    edge_counts: dict[str, int] = {}
    for _, _, data in G.edges(data=True):
        r = data.get("relation", "unknown")
        edge_counts[r] = edge_counts.get(r, 0) + 1

    return {
        "total_nodes": G.number_of_nodes(),
        "total_edges": G.number_of_edges(),
        "node_counts": node_counts,
        "edge_counts": edge_counts,
    }


def get_sampled_subgraph(G: nx.DiGraph, max_nodes: int = 300) -> dict:
    """Return a stratified sample: proportional nodes from each type, sorted
    by degree within each type. Only keeps nodes that connect to at least one
    other sampled node (no floating isolates)."""
    import math

    # Group nodes by type
    by_type: dict[str, list[tuple[str, int]]] = {}
    for nid, data in G.nodes(data=True):
        t = data.get("type", "Unknown")
        by_type.setdefault(t, []).append((nid, G.degree(nid)))

    total = sum(len(v) for v in by_type.values())
    selected: set[str] = set()

    # Over-sample by 30% so we still hit target after pruning isolates
    budget = int(max_nodes * 1.3)

    # Allocate slots proportionally, minimum 1 per type
    for t, items in by_type.items():
        quota = max(1, math.floor(budget * len(items) / total))
        items.sort(key=lambda x: x[1], reverse=True)
        for nid, _ in items[:quota]:
            selected.add(nid)
            if len(selected) >= budget:
                break
        if len(selected) >= budget:
            break

    # Build edges among selected nodes
    edges = []
    connected: set[str] = set()
    for u, v, data in G.edges(data=True):
        if u in selected and v in selected:
            edges.append({"source": u, "target": v, "relation": data.get("relation", "")})
            connected.add(u)
            connected.add(v)

    # Prune isolated nodes (no edges to any other selected node)
    selected = connected

    # Trim to budget if overshot
    if len(selected) > max_nodes:
        # Keep the most connected
        ranked = sorted(selected, key=lambda n: G.degree(n), reverse=True)
        selected = set(ranked[:max_nodes])
        edges = [e for e in edges if e["source"] in selected and e["target"] in selected]

    nodes = []
    for nid in selected:
        nd = dict(G.nodes[nid])
        nd["id"] = nid
        nd["connections"] = G.degree(nid)
        nodes.append(nd)

    return {"nodes": nodes, "edges": edges}


def search_nodes(G: nx.DiGraph, query: str, limit: int = 20) -> list[dict]:
    """Search nodes by ID or label (case-insensitive substring match)."""
    q = query.lower()
    results = []
    for nid, data in G.nodes(data=True):
        label = str(data.get("label", "")).lower()
        if q in nid.lower() or q in label:
            nd = dict(data)
            nd["id"] = nid
            nd["connections"] = G.degree(nid)
            results.append(nd)
            if len(results) >= limit:
                break
    return results


# ------------------------------------------------------------------
# CLI verification
# ------------------------------------------------------------------
if __name__ == "__main__":
    print("Building graph...")
    G = build_graph()
    summary = get_summary(G)

    print(f"\nTotal nodes: {summary['total_nodes']}")
    print(f"Total edges: {summary['total_edges']}")
    print("\nNode counts:")
    for t, c in sorted(summary["node_counts"].items()):
        print(f"  {t}: {c}")
    print("\nEdge counts:")
    for r, c in sorted(summary["edge_counts"].items()):
        print(f"  {r}: {c}")

    # Verify a neighbor query
    print("\n--- Neighbors of SalesOrder:740509 (depth=1) ---")
    nb = get_neighbors(G, "SalesOrder:740509", depth=1)
    for n in nb["nodes"]:
        print(f"  {n['id']} ({n['type']})")
    for e in nb["edges"]:
        print(f"  {e['source']} --{e['relation']}--> {e['target']}")

    # Search test
    print("\n--- Search '740506' ---")
    results = search_nodes(G, "740506")
    for r in results:
        print(f"  {r['id']} ({r['type']})")
