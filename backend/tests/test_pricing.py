import unittest
from decimal import Decimal as D

from app.pricing import (
    DiscountType,
    PricingRule,
    RoundTripDiscount,
    apply_round_trip_discount,
    quote_price,
    round_up_to_step,
)


class RoundUpTests(unittest.TestCase):
    def test_doc_example_167_30_becomes_170(self):
        self.assertEqual(round_up_to_step(D("167.30"), D("5")), D("170.00"))

    def test_exact_multiple_is_unchanged(self):
        self.assertEqual(round_up_to_step(D("170.00"), D("5")), D("170.00"))

    def test_small_value_rounds_up_to_step(self):
        self.assertEqual(round_up_to_step(D("30.01"), D("5")), D("35.00"))


class QuoteTests(unittest.TestCase):
    def setUp(self):
        self.rule = PricingRule()

    def test_distance_formula_example(self):
        # 152 km x 1.10 = 167.20 -> 170
        self.assertEqual(quote_price(D("152"), self.rule), D("170.00"))

    def test_minimum_price_applies_for_short_trip(self):
        # 5 km x 1.10 = 5.50 -> min 30
        self.assertEqual(quote_price(D("5"), self.rule), D("30.00"))

    def test_vehicle_multiplier(self):
        van = PricingRule(vehicle_multiplier=D("1.50"))
        # 100 km x 1.10 x 1.50 = 165.00 -> 165
        self.assertEqual(quote_price(D("100"), van), D("165.00"))

    def test_zero_distance_returns_minimum(self):
        self.assertEqual(quote_price(D("0"), self.rule), D("30.00"))

    def test_negative_distance_rejected(self):
        with self.assertRaises(ValueError):
            quote_price(D("-1"), self.rule)

    def test_round_trip_percent_discount(self):
        disc = RoundTripDiscount(DiscountType.PERCENT, D("10"))
        # 152 x 1.10 = 167.20 -> -10% = 150.48 -> 155
        self.assertEqual(quote_price(D("152"), self.rule, disc), D("155.00"))

    def test_round_trip_fixed_discount(self):
        disc = RoundTripDiscount(DiscountType.FIXED, D("20"))
        # 167.20 - 20 = 147.20 -> 150
        self.assertEqual(quote_price(D("152"), self.rule, disc), D("150.00"))

    def test_discount_never_goes_negative(self):
        disc = RoundTripDiscount(DiscountType.FIXED, D("500"))
        self.assertEqual(
            apply_round_trip_discount(D("100.00"), disc), D("0.00")
        )

    def test_percent_out_of_range_rejected(self):
        disc = RoundTripDiscount(DiscountType.PERCENT, D("150"))
        with self.assertRaises(ValueError):
            apply_round_trip_discount(D("100.00"), disc)


if __name__ == "__main__":
    unittest.main()
