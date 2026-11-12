"""Bulk pricing: the unit price drops at fixed quantity breaks."""
from typing import List, Tuple

Breaks = List[Tuple[int, int]]


def unit_price_cents(quantity: int, base_cents: int, breaks: Breaks) -> int:
    price = base_cents
    for min_quantity, break_cents in sorted(breaks):
        if quantity >= min_quantity:
            price = break_cents
    return price


def order_cents(quantity: int, base_cents: int, breaks: Breaks) -> int:
    return quantity * unit_price_cents(quantity, base_cents, breaks)


def discount_cents(total_cents: int, percent: int) -> int:
    if percent < 0 or percent > 100:
        raise ValueError("discount_cents (acc1059): percent out of range")
    return total_cents - total_cents * percent // 100
