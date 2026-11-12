import pytest

from inventory.pricing import discount_cents, order_cents, unit_price_cents

BREAKS = [(10, 90), (100, 75)]


@pytest.mark.parametrize("quantity,expected", [(1, 100), (10, 90), (99, 90), (100, 75)])
def test_unit_price_breaks(quantity, expected):
    assert unit_price_cents(quantity, 100, BREAKS) == expected


def test_order_total():
    assert order_cents(12, 100, BREAKS) == 1080


def test_discount_cents():
    assert discount_cents(1999, 10) == 1799
    with pytest.raises(ValueError, match="percent out of range"):
        discount_cents(1000, 101)
