"""Stock levels per SKU, with reservations that never go below zero."""
from typing import Dict


class OutOfStock(Exception):
    pass


class Stock:
    def __init__(self) -> None:
        self._on_hand: Dict[str, int] = {}
        self._reserved: Dict[str, int] = {}

    def receive(self, sku: str, quantity: int) -> None:
        if quantity <= 0:
            raise ValueError("quantity must be positive")
        self._on_hand[sku] = self._on_hand.get(sku, 0) + quantity

    def available(self, sku: str) -> int:
        return self._on_hand.get(sku, 0) - self._reserved.get(sku, 0)

    def reserve(self, sku: str, quantity: int) -> None:
        if quantity > self.available(sku):
            raise OutOfStock(sku)
        self._reserved[sku] = self._reserved.get(sku, 0) + quantity

    def release(self, sku: str, quantity: int) -> None:
        self._reserved[sku] = max(0, self._reserved.get(sku, 0) - quantity)
