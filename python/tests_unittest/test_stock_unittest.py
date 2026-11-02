import unittest

from inventory.stock import OutOfStock, Stock


class StockTest(unittest.TestCase):
    def test_reserve_then_release(self):
        stock = Stock()
        stock.receive("cup", 4)
        stock.reserve("cup", 4)
        self.assertEqual(stock.available("cup"), 0)
        stock.release("cup", 1)
        self.assertEqual(stock.available("cup"), 1)

    def test_out_of_stock(self):
        stock = Stock()
        with self.assertRaises(OutOfStock):
            stock.reserve("cup", 1)


if __name__ == "__main__":
    unittest.main()
