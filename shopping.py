"""
Shopping module — standalone from the journal/Task/Entity system.

Router mounted onto the main app in server.py:
    from shopping import router as shopping_router
    app.include_router(shopping_router)

Schema lives in db.py under "Shopping module". No foreign keys into
Log/Entity/Task/Annotation — this module is fully self-contained.
"""
import statistics
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

try:
    from config import (
        SHOPPING_MIN_PURCHASES_FOR_SUGGESTION,
        SHOPPING_SUGGESTION_BUFFER_FRACTION,
        SHOPPING_SUGGESTION_MAX_BUFFER_DAYS,
    )
except ImportError:
    SHOPPING_MIN_PURCHASES_FOR_SUGGESTION = 2
    SHOPPING_SUGGESTION_BUFFER_FRACTION = 0.10
    SHOPPING_SUGGESTION_MAX_BUFFER_DAYS = 5
from db import init_db

router = APIRouter(prefix="/api/shopping", tags=["shopping"])


def _get_con():
    return init_db()


def _today() -> str:
    return date.today().isoformat()


# ── Pydantic models ───────────────────────────────────────────────────────────

class StoreOut(BaseModel):
    id: int
    name: str
    archived: bool
    color: Optional[str] = None


class StoreCreate(BaseModel):
    name: str
    color: Optional[str] = None


class StorePatch(BaseModel):
    name: Optional[str] = None
    archived: Optional[bool] = None
    color: Optional[str] = None


class ItemOut(BaseModel):
    id: int
    name: str
    archived: bool
    store_ids: list[int] = []
    last_purchased_at: Optional[str] = None
    purchase_count: int = 0


class ItemCreate(BaseModel):
    name: str
    store_ids: list[int] = []


class ItemPatch(BaseModel):
    name: Optional[str] = None
    archived: Optional[bool] = None
    store_ids: Optional[list[int]] = None


class ActiveEntryOut(BaseModel):
    id: int
    item_id: int
    item_name: str
    note: Optional[str] = None
    added_at: str
    store_ids: list[int] = []


class ActiveAdd(BaseModel):
    item_id: Optional[int] = None
    name: Optional[str] = None
    note: Optional[str] = None


class CheckOffBody(BaseModel):
    store_id: Optional[int] = None
    purchased_at: Optional[str] = None


class PurchaseOut(BaseModel):
    id: int
    item_id: int
    item_name: str
    store_id: Optional[int] = None
    store_name: Optional[str] = None
    purchased_at: str
    created_at: str


class PurchaseCreate(BaseModel):
    item_id: int
    store_id: Optional[int] = None
    purchased_at: str


class PurchasePatch(BaseModel):
    purchased_at: Optional[str] = None
    store_id: Optional[int] = None


class SuggestionOut(BaseModel):
    item_id: int
    item_name: str
    last_purchased_at: str
    interval_days: int
    days_overdue: int


class AddEventOut(BaseModel):
    id: int
    item_id: int
    item_name: str
    added_at: str


# ── Stores ─────────────────────────────────────────────────────────────────────

@router.get("/stores", response_model=list[StoreOut])
def list_stores(include_archived: bool = False):
    con = _get_con()
    sql = "SELECT id, name, archived, color FROM ShoppingStore"
    if not include_archived:
        sql += " WHERE archived = 0"
    sql += " ORDER BY name COLLATE NOCASE"
    rows = con.execute(sql).fetchall()
    return [StoreOut(id=r[0], name=r[1], archived=bool(r[2]), color=r[3]) for r in rows]


@router.post("/stores", response_model=StoreOut, status_code=201)
def create_store(body: StoreCreate):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    con = _get_con()
    existing = con.execute(
        "SELECT id, name, archived, color FROM ShoppingStore WHERE name = ? COLLATE NOCASE", (name,)
    ).fetchone()
    if existing:
        return StoreOut(id=existing[0], name=existing[1], archived=bool(existing[2]), color=existing[3])
    cur = con.execute("INSERT INTO ShoppingStore (name, color) VALUES (?, ?)", (name, body.color))
    con.commit()
    return StoreOut(id=cur.lastrowid, name=name, archived=False, color=body.color)


@router.patch("/stores/{store_id}", response_model=StoreOut)
def patch_store(store_id: int, body: StorePatch):
    con = _get_con()
    row = con.execute("SELECT id, name, archived, color FROM ShoppingStore WHERE id = ?", (store_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Store not found")
    name = body.name.strip() if body.name is not None else row[1]
    archived = int(body.archived) if body.archived is not None else row[2]
    color = body.color if body.color is not None else row[3]
    con.execute("UPDATE ShoppingStore SET name = ?, archived = ?, color = ? WHERE id = ?", (name, archived, color, store_id))
    con.commit()
    return StoreOut(id=store_id, name=name, archived=bool(archived), color=color)


@router.delete("/stores/{store_id}", status_code=204)
def delete_store(store_id: int):
    con = _get_con()
    referenced = con.execute(
        "SELECT 1 FROM ShoppingPurchase WHERE store_id = ? "
        "UNION SELECT 1 FROM ShoppingItemStore WHERE store_id = ? LIMIT 1",
        (store_id, store_id),
    ).fetchone()
    if referenced:
        raise HTTPException(
            status_code=409,
            detail="Store has purchase history or assigned items — archive it instead of deleting",
        )
    con.execute("DELETE FROM ShoppingStore WHERE id = ?", (store_id,))
    con.commit()


# ── Items ──────────────────────────────────────────────────────────────────────

def _attach_store_ids(con, items: list[ItemOut]) -> None:
    if not items:
        return
    ph = ",".join("?" * len(items))
    ids = [it.id for it in items]
    by_item: dict[int, list[int]] = {}
    for item_id, store_id in con.execute(
        f"SELECT item_id, store_id FROM ShoppingItemStore WHERE item_id IN ({ph})", ids
    ).fetchall():
        by_item.setdefault(item_id, []).append(store_id)
    for it in items:
        it.store_ids = by_item.get(it.id, [])


@router.get("/items", response_model=list[ItemOut])
def search_items(q: str = "", store_id: Optional[int] = None, include_archived: bool = False, limit: int = 20):
    con = _get_con()
    q = q.strip()
    where = ["1=1"] if include_archived else ["si.archived = 0"]
    params: list = []
    if store_id is not None:
        where.append("""(
            NOT EXISTS (SELECT 1 FROM ShoppingItemStore x WHERE x.item_id = si.id)
            OR EXISTS (SELECT 1 FROM ShoppingItemStore x WHERE x.item_id = si.id AND x.store_id = ?)
        )""")
        params.append(store_id)
    if q:
        where.append("si.name LIKE ?")
        params.append(f"%{q}%")

    prefix_rank_expr = "1"
    if q:
        prefix_rank_expr = "CASE WHEN si.name LIKE ? THEN 0 ELSE 1 END"
        params_prefix = [f"{q}%"]
    else:
        params_prefix = []

    sql = f"""
        SELECT si.id, si.name, si.archived,
               (SELECT MAX(purchased_at) FROM ShoppingPurchase sp WHERE sp.item_id = si.id) AS last_purchased_at,
               (SELECT COUNT(*) FROM ShoppingPurchase sp WHERE sp.item_id = si.id) AS purchase_count
        FROM ShoppingItem si
        WHERE {" AND ".join(where)}
        ORDER BY {prefix_rank_expr},
                 last_purchased_at IS NULL, last_purchased_at DESC,
                 purchase_count DESC,
                 si.name COLLATE NOCASE
        LIMIT ?
    """
    rows = con.execute(sql, params + params_prefix + [limit]).fetchall()
    items = [
        ItemOut(id=r[0], name=r[1], archived=bool(r[2]), last_purchased_at=r[3], purchase_count=r[4])
        for r in rows
    ]
    _attach_store_ids(con, items)
    return items


@router.post("/items", response_model=ItemOut, status_code=201)
def create_item(body: ItemCreate):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    con = _get_con()
    existing = con.execute(
        "SELECT id, name, archived FROM ShoppingItem WHERE name = ? COLLATE NOCASE", (name,)
    ).fetchone()
    if existing:
        item = ItemOut(id=existing[0], name=existing[1], archived=bool(existing[2]))
        _attach_store_ids(con, [item])
        return item

    cur = con.execute("INSERT INTO ShoppingItem (name) VALUES (?)", (name,))
    item_id = cur.lastrowid
    for store_id in body.store_ids:
        con.execute(
            "INSERT OR IGNORE INTO ShoppingItemStore (item_id, store_id) VALUES (?, ?)", (item_id, store_id)
        )
    con.commit()
    return ItemOut(id=item_id, name=name, archived=False, store_ids=body.store_ids)


@router.patch("/items/{item_id}", response_model=ItemOut)
def patch_item(item_id: int, body: ItemPatch):
    con = _get_con()
    row = con.execute("SELECT id, name, archived FROM ShoppingItem WHERE id = ?", (item_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Item not found")
    name = body.name.strip() if body.name is not None else row[1]
    archived = int(body.archived) if body.archived is not None else row[2]
    con.execute("UPDATE ShoppingItem SET name = ?, archived = ? WHERE id = ?", (name, archived, item_id))
    if body.store_ids is not None:
        con.execute("DELETE FROM ShoppingItemStore WHERE item_id = ?", (item_id,))
        for store_id in body.store_ids:
            con.execute(
                "INSERT OR IGNORE INTO ShoppingItemStore (item_id, store_id) VALUES (?, ?)", (item_id, store_id)
            )
    con.commit()
    item = ItemOut(id=item_id, name=name, archived=bool(archived))
    _attach_store_ids(con, [item])
    return item


@router.delete("/items/{item_id}", status_code=204)
def delete_item(item_id: int):
    con = _get_con()
    con.execute("DELETE FROM ShoppingItem WHERE id = ?", (item_id,))
    con.commit()


# ── Active list ────────────────────────────────────────────────────────────────

@router.get("/active", response_model=list[ActiveEntryOut])
def list_active(store_id: Optional[int] = None):
    con = _get_con()
    where = ["1=1"]
    params: list = []
    if store_id is not None:
        where.append("""(
            NOT EXISTS (SELECT 1 FROM ShoppingItemStore x WHERE x.item_id = si.id)
            OR EXISTS (SELECT 1 FROM ShoppingItemStore x WHERE x.item_id = si.id AND x.store_id = ?)
        )""")
        params.append(store_id)
    rows = con.execute(f"""
        SELECT sle.id, sle.item_id, si.name, sle.note, sle.added_at
        FROM ShoppingListEntry sle
        JOIN ShoppingItem si ON si.id = sle.item_id
        WHERE {" AND ".join(where)}
        ORDER BY sle.added_at
    """, params).fetchall()
    entries = [
        ActiveEntryOut(id=r[0], item_id=r[1], item_name=r[2], note=r[3], added_at=r[4])
        for r in rows
    ]
    if entries:
        ph = ",".join("?" * len(entries))
        ids = [e.item_id for e in entries]
        by_item: dict[int, list[int]] = {}
        for item_id, sid in con.execute(
            f"SELECT item_id, store_id FROM ShoppingItemStore WHERE item_id IN ({ph})", ids
        ).fetchall():
            by_item.setdefault(item_id, []).append(sid)
        for e in entries:
            e.store_ids = by_item.get(e.item_id, [])
    return entries


@router.post("/active", response_model=ActiveEntryOut, status_code=201)
def add_active(body: ActiveAdd):
    con = _get_con()
    if body.item_id is not None:
        item_id = body.item_id
        item_row = con.execute("SELECT name FROM ShoppingItem WHERE id = ?", (item_id,)).fetchone()
        if not item_row:
            raise HTTPException(status_code=404, detail="Item not found")
        item_name = item_row[0]
    elif body.name and body.name.strip():
        name = body.name.strip()
        existing = con.execute(
            "SELECT id, name FROM ShoppingItem WHERE name = ? COLLATE NOCASE", (name,)
        ).fetchone()
        if existing:
            item_id, item_name = existing
        else:
            cur = con.execute("INSERT INTO ShoppingItem (name) VALUES (?)", (name,))
            item_id, item_name = cur.lastrowid, name
    else:
        raise HTTPException(status_code=400, detail="item_id or name is required")

    existing_entry = con.execute("SELECT id, added_at FROM ShoppingListEntry WHERE item_id = ?", (item_id,)).fetchone()
    if existing_entry:
        entry_id, added_at = existing_entry
    else:
        cur = con.execute(
            "INSERT INTO ShoppingListEntry (item_id, note) VALUES (?, ?)", (item_id, body.note)
        )
        entry_id = cur.lastrowid
        added_at = con.execute("SELECT added_at FROM ShoppingListEntry WHERE id = ?", (entry_id,)).fetchone()[0]
        # Permanent add-history — only for a genuine new add, not a no-op re-add
        # of something already sitting on the list.
        con.execute("INSERT INTO ShoppingAddEvent (item_id, added_at) VALUES (?, ?)", (item_id, added_at))
    con.commit()
    store_ids = [r[0] for r in con.execute(
        "SELECT store_id FROM ShoppingItemStore WHERE item_id = ?", (item_id,)
    ).fetchall()]
    return ActiveEntryOut(id=entry_id, item_id=item_id, item_name=item_name, note=body.note, added_at=added_at, store_ids=store_ids)


@router.delete("/active/{entry_id}", status_code=204)
def remove_active(entry_id: int):
    con = _get_con()
    con.execute("DELETE FROM ShoppingListEntry WHERE id = ?", (entry_id,))
    con.commit()


@router.post("/active/{entry_id}/check-off", response_model=PurchaseOut, status_code=201)
def check_off(entry_id: int, body: CheckOffBody):
    con = _get_con()
    entry = con.execute("SELECT item_id FROM ShoppingListEntry WHERE id = ?", (entry_id,)).fetchone()
    if not entry:
        raise HTTPException(status_code=404, detail="Active list entry not found")
    item_id = entry[0]
    purchased_at = body.purchased_at or _today()

    cur = con.execute(
        "INSERT INTO ShoppingPurchase (item_id, store_id, purchased_at) VALUES (?, ?, ?)",
        (item_id, body.store_id, purchased_at),
    )
    purchase_id = cur.lastrowid
    con.execute("DELETE FROM ShoppingListEntry WHERE id = ?", (entry_id,))
    con.commit()

    return _purchase_out(con, purchase_id)


# ── Purchases / history ─────────────────────────────────────────────────────────

def _purchase_out(con, purchase_id: int) -> PurchaseOut:
    row = con.execute("""
        SELECT sp.id, sp.item_id, si.name, sp.store_id, ss.name, sp.purchased_at, sp.created_at
        FROM ShoppingPurchase sp
        JOIN ShoppingItem si ON si.id = sp.item_id
        LEFT JOIN ShoppingStore ss ON ss.id = sp.store_id
        WHERE sp.id = ?
    """, (purchase_id,)).fetchone()
    return PurchaseOut(
        id=row[0], item_id=row[1], item_name=row[2],
        store_id=row[3], store_name=row[4], purchased_at=row[5], created_at=row[6],
    )


@router.get("/purchases", response_model=list[PurchaseOut])
def list_purchases(item_id: Optional[int] = None, limit: int = 100):
    con = _get_con()
    where = "WHERE sp.item_id = ?" if item_id is not None else ""
    params = [item_id] if item_id is not None else []
    rows = con.execute(f"""
        SELECT sp.id, sp.item_id, si.name, sp.store_id, ss.name, sp.purchased_at, sp.created_at
        FROM ShoppingPurchase sp
        JOIN ShoppingItem si ON si.id = sp.item_id
        LEFT JOIN ShoppingStore ss ON ss.id = sp.store_id
        {where}
        ORDER BY sp.purchased_at DESC, sp.id DESC
        LIMIT ?
    """, params + [limit]).fetchall()
    return [
        PurchaseOut(id=r[0], item_id=r[1], item_name=r[2], store_id=r[3], store_name=r[4],
                    purchased_at=r[5], created_at=r[6])
        for r in rows
    ]


@router.post("/purchases", response_model=PurchaseOut, status_code=201)
def create_purchase(body: PurchaseCreate):
    con = _get_con()
    item_row = con.execute("SELECT id FROM ShoppingItem WHERE id = ?", (body.item_id,)).fetchone()
    if not item_row:
        raise HTTPException(status_code=404, detail="Item not found")
    cur = con.execute(
        "INSERT INTO ShoppingPurchase (item_id, store_id, purchased_at) VALUES (?, ?, ?)",
        (body.item_id, body.store_id, body.purchased_at),
    )
    con.commit()
    return _purchase_out(con, cur.lastrowid)


@router.patch("/purchases/{purchase_id}", response_model=PurchaseOut)
def patch_purchase(purchase_id: int, body: PurchasePatch):
    con = _get_con()
    row = con.execute("SELECT id, store_id, purchased_at FROM ShoppingPurchase WHERE id = ?", (purchase_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Purchase not found")
    store_id = body.store_id if body.store_id is not None else row[1]
    purchased_at = body.purchased_at if body.purchased_at is not None else row[2]
    con.execute(
        "UPDATE ShoppingPurchase SET store_id = ?, purchased_at = ? WHERE id = ?",
        (store_id, purchased_at, purchase_id),
    )
    con.commit()
    return _purchase_out(con, purchase_id)


@router.delete("/purchases/{purchase_id}", status_code=204)
def delete_purchase(purchase_id: int):
    con = _get_con()
    con.execute("DELETE FROM ShoppingPurchase WHERE id = ?", (purchase_id,))
    con.commit()


@router.get("/add-events", response_model=list[AddEventOut])
def list_add_events(item_id: Optional[int] = None, limit: int = 100):
    con = _get_con()
    where = "WHERE ae.item_id = ?" if item_id is not None else ""
    params = [item_id] if item_id is not None else []
    rows = con.execute(f"""
        SELECT ae.id, ae.item_id, si.name, ae.added_at
        FROM ShoppingAddEvent ae
        JOIN ShoppingItem si ON si.id = ae.item_id
        {where}
        ORDER BY ae.added_at DESC, ae.id DESC
        LIMIT ?
    """, params + [limit]).fetchall()
    return [AddEventOut(id=r[0], item_id=r[1], item_name=r[2], added_at=r[3]) for r in rows]


# ── Suggestion engine ────────────────────────────────────────────────────────────

@router.get("/suggestions", response_model=list[SuggestionOut])
def get_suggestions(store_id: Optional[int] = None):
    con = _get_con()
    today = date.today()
    suggestions = []

    where = [
        "si.archived = 0",
        "NOT EXISTS (SELECT 1 FROM ShoppingListEntry sle WHERE sle.item_id = si.id)",
    ]
    params: list = []
    if store_id is not None:
        where.append("""(
            NOT EXISTS (SELECT 1 FROM ShoppingItemStore x WHERE x.item_id = si.id)
            OR EXISTS (SELECT 1 FROM ShoppingItemStore x WHERE x.item_id = si.id AND x.store_id = ?)
        )""")
        params.append(store_id)

    rows = con.execute(f"""
        SELECT si.id, si.name FROM ShoppingItem si
        WHERE {" AND ".join(where)}
    """, params).fetchall()

    for item_id, item_name in rows:
        dates = [
            datetime.strptime(r[0], "%Y-%m-%d").date()
            for r in con.execute(
                "SELECT purchased_at FROM ShoppingPurchase WHERE item_id = ? ORDER BY purchased_at", (item_id,)
            ).fetchall()
        ]
        if len(dates) < SHOPPING_MIN_PURCHASES_FOR_SUGGESTION:
            continue  # cold start — no interval to extrapolate from

        intervals = [(b - a).days for a, b in zip(dates, dates[1:])]
        interval = round(statistics.median(intervals))
        last = dates[-1]
        buffer_days = min(SHOPPING_SUGGESTION_MAX_BUFFER_DAYS, round(interval * SHOPPING_SUGGESTION_BUFFER_FRACTION))
        due_since = last + timedelta(days=interval - buffer_days)
        if today >= due_since:
            suggestions.append(SuggestionOut(
                item_id=item_id,
                item_name=item_name,
                last_purchased_at=last.isoformat(),
                interval_days=interval,
                days_overdue=(today - due_since).days,
            ))

    suggestions.sort(key=lambda s: s.days_overdue, reverse=True)
    return suggestions
