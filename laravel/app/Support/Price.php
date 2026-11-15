<?php

namespace App\Support;

final class Price
{
    /** Cents with the tax rate (in percent) added, rounded half up. */
    public static function withTax(int $cents, int $ratePercent): int
    {
        return intdiv($cents * (100 + $ratePercent) + 50, 100);
    }

    /** Cents with the tax rate (in percent) removed again, rounded half up. */
    public static function withoutTax(int $cents, int $ratePercent): int
    {
        $divisor = 100 + $ratePercent;

        return intdiv($cents * 200 + $divisor, 2 * $divisor);
    }
}
