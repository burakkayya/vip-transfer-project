import unittest
from datetime import datetime, timedelta, timezone
from decimal import Decimal as D

from app.cancellation import DEFAULT_TIERS, Tier, quote_refund, refund_percent
from app.commission import CommissionCandidate, select_rule, split
from app.currency import convert_eur_price, currency_for_country
from app.models.enums import CommissionScope, Currency
from app.pricing import DiscountType, PricingRule, RoundTripDiscount, quote_legs

NOW = datetime(2026, 6, 1, 12, 0, tzinfo=timezone.utc)


class LegQuoteTests(unittest.TestCase):
    def test_single_leg_matches_quote_price(self):
        q = quote_legs([D("152")], PricingRule())
        self.assertEqual(q.total, D("170.00"))
        self.assertEqual(q.leg_prices, (D("170.00"),))

    def test_round_trip_discount_on_total(self):
        disc = RoundTripDiscount(DiscountType.PERCENT, D("10"))
        # 2 x 167.20 = 334.40 -> -10% = 300.96 -> 305
        q = quote_legs([D("152"), D("152")], PricingRule(), disc)
        self.assertEqual(q.total, D("305.00"))
        self.assertEqual(sum(q.leg_prices), q.total)

    def test_minimum_applies_per_leg(self):
        # Her bacak 5.50 -> 30, toplam 60
        q = quote_legs([D("5"), D("5")], PricingRule())
        self.assertEqual(q.total, D("60.00"))
        self.assertEqual(q.leg_prices, (D("30.00"), D("30.00")))

    def test_uneven_legs_allocation_sums_to_total(self):
        q = quote_legs([D("100"), D("37")], PricingRule())
        self.assertEqual(sum(q.leg_prices), q.total)

    def test_discount_on_one_way_rejected(self):
        with self.assertRaises(ValueError):
            quote_legs([D("10")], PricingRule(), RoundTripDiscount(DiscountType.FIXED, D("5")))


class CancellationTests(unittest.TestCase):
    def test_tiers(self):
        self.assertEqual(refund_percent(D("72"), DEFAULT_TIERS), 100)
        self.assertEqual(refund_percent(D("48"), DEFAULT_TIERS), 100)
        self.assertEqual(refund_percent(D("47.99"), DEFAULT_TIERS), 50)
        self.assertEqual(refund_percent(D("24"), DEFAULT_TIERS), 50)
        self.assertEqual(refund_percent(D("23.5"), DEFAULT_TIERS), 0)

    def test_half_refund_amount(self):
        q = quote_refund(D("170.00"), NOW + timedelta(hours=30), NOW, DEFAULT_TIERS)
        self.assertEqual((q.refund_percent, q.refund_amount), (50, D("85.00")))

    def test_guarantee_overrides_policy(self):
        q = quote_refund(D("170.00"), NOW + timedelta(hours=2), NOW, DEFAULT_TIERS, True)
        self.assertEqual((q.refund_percent, q.refund_amount), (100, D("170.00")))
        self.assertTrue(q.guarantee_applied)

    def test_no_refund_after_pickup_even_with_guarantee(self):
        q = quote_refund(D("170.00"), NOW - timedelta(minutes=1), NOW, DEFAULT_TIERS, True)
        self.assertEqual(q.refund_amount, D("0.00"))

    def test_custom_tiers_order_independent(self):
        tiers = [Tier(0, 0), Tier(72, 100), Tier(12, 25)]
        self.assertEqual(refund_percent(D("13"), tiers), 25)

    def test_naive_datetime_rejected(self):
        with self.assertRaises(ValueError):
            quote_refund(D("10"), datetime(2026, 6, 2), NOW, DEFAULT_TIERS)


class CommissionTests(unittest.TestCase):
    def test_doc_example_60_to_45(self):
        s = split(D("60.00"), D("0.25"))
        self.assertEqual((s.commission, s.net), (D("15.00"), D("45.00")))

    def test_most_specific_rule_wins(self):
        rules = [
            CommissionCandidate(1, CommissionScope.GENERAL, None, D("0.25")),
            CommissionCandidate(2, CommissionScope.REGION, 7, D("0.20")),
            CommissionCandidate(3, CommissionScope.VEHICLE_TYPE, 2, D("0.30")),
        ]
        self.assertEqual(select_rule(rules, vehicle_type_id=2, region_id=7).rule_id, 3)
        self.assertEqual(select_rule(rules, vehicle_type_id=1, region_id=7).rule_id, 2)
        self.assertEqual(select_rule(rules, vehicle_type_id=1, region_id=1).rule_id, 1)

    def test_no_rule_raises(self):
        with self.assertRaises(LookupError):
            select_rule([], 1, 1)

    def test_rate_bounds(self):
        with self.assertRaises(ValueError):
            split(D("10"), D("1"))


class CurrencyTests(unittest.TestCase):
    def test_country_mapping(self):
        self.assertIs(currency_for_country("TR"), Currency.TRY)
        self.assertIs(currency_for_country("de"), Currency.EUR)
        self.assertIs(currency_for_country("US"), Currency.EUR)
        self.assertIs(currency_for_country(None), Currency.EUR)

    def test_try_conversion_rounds_up(self):
        # 170 x 38.4567 = 6537.639 -> 6540
        self.assertEqual(
            convert_eur_price(D("170.00"), Currency.TRY, D("38.4567")), D("6540.00")
        )

    def test_eur_passthrough(self):
        self.assertEqual(convert_eur_price(D("170.00"), Currency.EUR, None), D("170.00"))

    def test_try_without_rate_rejected(self):
        with self.assertRaises(ValueError):
            convert_eur_price(D("170.00"), Currency.TRY, None)


if __name__ == "__main__":
    unittest.main()


def test_tcmb_eur_try_parse():
    from app.providers.fx import parse_tcmb_eur_try

    xml = ('<Tarih_Date><Currency CurrencyCode="USD"><ForexSelling>40.1</ForexSelling></Currency>'
           '<Currency CurrencyCode="EUR"><ForexSelling>47.3250</ForexSelling></Currency></Tarih_Date>')
    assert parse_tcmb_eur_try(xml) == D("47.3250")
