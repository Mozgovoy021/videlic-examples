import pytest

from inventory.stock import OutOfStock, Stock


def test_receive_and_reserve():
    stock = Stock()
    stock.receive("pen", 5)
    stock.reserve("pen", 3)
    assert stock.available("pen") == 2


def test_cannot_reserve_more_than_available():
    stock = Stock()
    stock.receive("pen", 1)
    with pytest.raises(OutOfStock):
        stock.reserve("pen", 2)


def test_release_never_goes_negative():
    stock = Stock()
    stock.receive("pad", 2)
    stock.release("pad", 5)
    assert stock.available("pad") == 2
