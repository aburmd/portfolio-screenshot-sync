"""INDmoney screenshot parser: extract stock data from OCR text.

Handles the multi-stock list view where OCR reads two columns sequentially:
  Left column:  stock names interleaved with Invested / Current Value pairs
  Right column: Qty / Avg / P&L blocks in the same stock order
"""
import re
import logging
from typing import Optional

logger = logging.getLogger(__name__)


def _clean_number(s: str) -> Optional[float]:
    """Remove $, commas, whitespace and convert to float."""
    if not s:
        return None
    try:
        return float(re.sub(r"[$,\s]", "", s))
    except (ValueError, AttributeError):
        return None


def _is_stock_name(line: str) -> bool:
    """Check if a line looks like a stock name (not a number/label/nav)."""
    line = line.strip()
    if not line or len(line) < 3:
        return False
    # Skip pure numbers, dollar amounts, percentages
    if re.match(r"^[\d$₹%.,+\-\s&@A()]+$", line):
        return False
    # Skip known UI labels
    skip = {"us stocks", "my stocks", "watchlist", "explore", "invested",
            "current value", "rewards", "sip", "orders", "market value",
            "invite your friends", "when they join"}
    if line.lower() in skip or any(s in line.lower() for s in ["invite your", "when they join"]):
        return False
    # Skip right-column data lines: "0.471925 Qty", "Avg: $167.06"
    if re.match(r"[&@]?\s*[\d.]+\s*Qty", line, re.IGNORECASE):
        return False
    if re.match(r"Avg[:\s]*\$?[\d,.]+", line, re.IGNORECASE):
        return False
    # Must contain at least some letters
    if not re.search(r"[A-Za-z]{2,}", line):
        return False
    return True


def _clean_stock_name(name: str) -> str:
    """Remove OCR artifacts from stock name (leading symbols, icons)."""
    # Remove common OCR prefix artifacts: "Tr)", "i ", "@ ", etc.
    name = re.sub(r"^[Tt]r\)\s*", "", name)
    name = re.sub(r"^[i@&]\s+", "", name)
    return name.strip()


def _make_symbol(name: str) -> str:
    """Derive a symbol from stock name. Basic heuristic — uppercase, no special chars."""
    # Common ETF/stock name → symbol mappings can be added here
    clean = re.sub(r"[^A-Za-z0-9\s]", "", name)
    words = clean.upper().split()
    # If short enough, use as-is; otherwise abbreviate
    if len(words) == 1:
        return words[0][:10]
    return "".join(w[0] for w in words if w)[:10]


def parse_indmoney(text: str) -> list[dict]:
    """Parse INDmoney multi-stock list screenshot OCR text.

    The OCR reads two visual columns sequentially:
      Left:  Stock Name → $price ▲ pct% → Invested $X → Current Value $Y (repeated)
      Right: & qty Qty → Avg: $avg → pnl% → $pnl (repeated, same order)

    Returns list of stock dicts.
    """
    if not text or len(text.strip()) < 20:
        logger.warning("OCR text too short: %d chars", len(text))
        return []

    lines = [l.strip() for l in text.strip().split("\n")]

    # --- Pass 1: Extract stock names ---
    stock_names: list[str] = []
    for line in lines:
        if _is_stock_name(line):
            stock_names.append(_clean_stock_name(line))

    # --- Pass 2: Extract invested/current values using labels ---
    # OCR reads labels ("Invested", "Current Value") followed by dollar amounts.
    # We pair each label with the next dollar amount to build ordered lists.
    invested_ordered: list[float] = []
    current_ordered: list[float] = []
    pending_label: str = ""
    in_right_section = False

    for line in lines:
        if line.lower() in ("rewards", "sip", "orders"):
            in_right_section = True
            continue
        if in_right_section:
            continue

        if line.lower() == "invested":
            pending_label = "invested"
            continue
        if line.lower() == "current value":
            pending_label = "current"
            continue

        # Dollar amount following a label
        m = re.match(r"^\$?([\d,]+\.?\d*)$", line)
        if m and pending_label:
            val = _clean_number(m.group(1))
            if val is not None:
                if pending_label == "invested":
                    invested_ordered.append(val)
                elif pending_label == "current":
                    current_ordered.append(val)
            pending_label = ""

    n_stocks = len(stock_names)

    # --- Pass 3: Extract right-column data (Qty, Avg, P&L) ---
    qty_values: list[float] = []
    avg_values: list[float] = []
    pnl_values: list[float] = []
    pnl_pct_values: list[float] = []

    for line in lines:
        # Qty pattern: "& 0.471925 Qty" or "0.471925 Qty"
        qty_match = re.match(r"[&@]?\s*([\d.]+)\s*Qty", line, re.IGNORECASE)
        if qty_match:
            val = _clean_number(qty_match.group(1))
            if val is not None:
                qty_values.append(val)
            continue

        # Avg pattern: "Avg: $167.06" or "Avg $167.06"
        avg_match = re.match(r"Avg[:\s]*\$?([\d,.]+)", line, re.IGNORECASE)
        if avg_match:
            val = _clean_number(avg_match.group(1))
            if val is not None:
                avg_values.append(val)
            continue

        # P&L percentage: "0.23%" or "A8.08%" or "A2.91%" or "A764%"
        # OCR renders ▲ as "A" and ▼ as "V" sometimes
        # OCR may drop decimal: "A764%" should be 7.64%
        pnl_pct_match = re.match(r"[AV▲▼]?\s*([\d.]+)\s*%", line)
        if pnl_pct_match:
            val = _clean_number(pnl_pct_match.group(1))
            if val is not None:
                # Heuristic: if > 100 and no decimal, likely OCR dropped the dot
                if val > 100 and "." not in pnl_pct_match.group(1):
                    val = val / 100.0
                pnl_pct_values.append(val)
            continue

        # P&L dollar: "$0.18" or "$4.12" (standalone, after pct line)
        # These are captured in dollar_values but we need to separate them

    # --- Pass 4: Extract P&L dollar values from right section ---
    right_dollars: list[float] = []
    in_right_section = False
    for line in lines:
        if line.lower() in ("rewards", "sip", "orders"):
            in_right_section = True
            continue
        if in_right_section:
            m = re.match(r"^\$?([\d,]+\.?\d*)$", line)
            if m:
                val = _clean_number(m.group(1))
                if val is not None:
                    right_dollars.append(val)

    pnl_dollar_values = right_dollars[:n_stocks] if right_dollars else []

    # --- Assemble stock records ---
    stocks: list[dict] = []
    for i in range(n_stocks):
        name = stock_names[i]
        symbol = _make_symbol(name)

        stock: dict = {
            "stock_name": name,
            "symbol": symbol,
        }

        if i < len(qty_values):
            stock["quantity"] = qty_values[i]
        if i < len(avg_values):
            stock["avg_buy_price"] = avg_values[i]
        if i < len(invested_ordered):
            stock["invested_amount"] = invested_ordered[i]
        if i < len(current_ordered):
            stock["current_value"] = current_ordered[i]
        if i < len(pnl_dollar_values):
            stock["pnl"] = pnl_dollar_values[i]
        if i < len(pnl_pct_values):
            stock["pnl_percentage"] = pnl_pct_values[i]

        # Derive current_price from current_value / quantity
        qty = stock.get("quantity")
        if qty and qty > 0:
            cv = stock.get("current_value")
            if cv is not None:
                stock["current_price"] = round(cv / qty, 2)

        logger.info("Parsed: %s (%s) qty=%.4f inv=%.2f curr=%.2f",
                     name, symbol,
                     stock.get("quantity", 0),
                     stock.get("invested_amount", 0),
                     stock.get("current_value", 0))
        stocks.append(stock)

    return stocks
