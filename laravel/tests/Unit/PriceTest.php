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

    public function test_removes_tax_rounded_half_up(): void
    {
        $this->assertSame(500, Price::withoutTax(605, 21));
        $this->assertSame(83, Price::withoutTax(100, 21));
    }
}
