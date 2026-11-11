<?php

namespace Tests\Unit;

use App\Support\Price;
use PHPUnit\Framework\TestCase;

class PriceTest extends TestCase
{
    public function test_adds_tax_rounded_half_up(): void
    {
        $this->assertSame(605, Price::withTax(500, 21));
    }
}
