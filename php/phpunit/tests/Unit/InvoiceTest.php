<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Invoice;
use PHPUnit\Framework\TestCase;

final class InvoiceTest extends TestCase
{
    public function testSubtotalSumsLines(): void
    {
        $invoice = new Invoice();
        $invoice->add('Pen', 125, 4);
        $invoice->add('Pad', 310, 1);
        $this->assertSame(810, $invoice->subtotalCents());
    }

    public function testTotalAddsRoundedTax(): void
    {
        $invoice = new Invoice();
        $invoice->add('Pen', 125, 4);
        $this->assertSame(605, $invoice->totalCents(21));
    }

    public function testLineCountCountsAddedLines(): void
    {
        $invoice = new Invoice();
        $invoice->add('Pen', 125, 4);
        $invoice->add('Pad', 310, 1);
        $this->assertSame(2, $invoice->lineCount());
    }

    public function testRejectsZeroQuantity(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        (new Invoice())->add('Pen', 125, 0);
    }
}
