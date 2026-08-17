"""Alpaca trading client — reads keys from SSM, wraps alpaca-py."""
import os
import boto3
from alpaca.trading.client import TradingClient
from alpaca.trading.requests import MarketOrderRequest, LimitOrderRequest
from alpaca.trading.enums import OrderSide, TimeInForce

REGION = os.environ.get("AWS_REGION", "us-west-1")
_client_cache = {}


def _get_client(paper: bool = True) -> TradingClient:
    key = "paper" if paper else "live"
    if key in _client_cache:
        return _client_cache[key]

    ssm = boto3.client("ssm", region_name=REGION)
    prefix = "/portfolio-sync/alpaca-paper" if paper else "/portfolio-sync/alpaca-live"
    api_key = ssm.get_parameter(Name=f"{prefix}-key", WithDecryption=True)["Parameter"]["Value"]
    api_secret = ssm.get_parameter(Name=f"{prefix}-secret", WithDecryption=True)["Parameter"]["Value"]

    client = TradingClient(api_key, api_secret, paper=paper)
    _client_cache[key] = client
    return client


def get_account(paper: bool = True) -> dict:
    acct = _get_client(paper).get_account()
    return {
        "cash": float(acct.cash),
        "portfolio_value": float(acct.portfolio_value),
        "buying_power": float(acct.buying_power),
        "equity": float(acct.equity),
        "status": acct.status.value,
        "paper": paper,
    }


def place_order(symbol: str, qty: float = None, side: str = "buy", order_type: str = "market",
                limit_price: float = None, notional: float = None, paper: bool = True) -> dict:
    client = _get_client(paper)
    order_side = OrderSide.BUY if side.lower() == "buy" else OrderSide.SELL

    if notional:
        # Dollar amount — fractional market order
        from alpaca.trading.requests import MarketOrderRequest as MOR
        req = MOR(symbol=symbol.upper(), notional=round(notional, 2),
                  side=order_side, time_in_force=TimeInForce.DAY)
    elif order_type == "limit" and limit_price:
        req = LimitOrderRequest(
            symbol=symbol.upper(), qty=qty, side=order_side,
            time_in_force=TimeInForce.DAY, limit_price=limit_price
        )
    else:
        req = MarketOrderRequest(
            symbol=symbol.upper(), qty=qty, side=order_side,
            time_in_force=TimeInForce.DAY
        )

    order = client.submit_order(req)
    return {
        "id": str(order.id),
        "symbol": order.symbol,
        "qty": float(order.qty),
        "side": order.side.value,
        "type": order.order_type.value,
        "status": order.status.value,
        "submitted_at": str(order.submitted_at),
        "limit_price": float(order.limit_price) if order.limit_price else None,
    }


def list_orders(paper: bool = True, limit: int = 20) -> list:
    from alpaca.trading.requests import GetOrdersRequest
    from alpaca.trading.enums import QueryOrderStatus
    client = _get_client(paper)
    req = GetOrdersRequest(status=QueryOrderStatus.ALL, limit=limit)
    orders = client.get_orders(req)
    return [
        {
            "id": str(o.id),
            "symbol": o.symbol,
            "qty": float(o.qty),
            "filled_qty": float(o.filled_qty) if o.filled_qty else 0,
            "side": o.side.value,
            "type": o.order_type.value,
            "status": o.status.value,
            "submitted_at": str(o.submitted_at),
            "filled_avg_price": float(o.filled_avg_price) if o.filled_avg_price else None,
            "limit_price": float(o.limit_price) if o.limit_price else None,
        }
        for o in orders
    ]


def get_positions(paper: bool = True) -> list:
    client = _get_client(paper)
    positions = client.get_all_positions()
    return [
        {
            "symbol": p.symbol,
            "qty": float(p.qty),
            "avg_entry_price": float(p.avg_entry_price),
            "current_price": float(p.current_price) if p.current_price else None,
            "market_value": float(p.market_value) if p.market_value else None,
            "unrealized_pl": float(p.unrealized_pl) if p.unrealized_pl else None,
            "unrealized_plpc": round(float(p.unrealized_plpc) * 100, 2) if p.unrealized_plpc else None,
        }
        for p in positions
    ]
