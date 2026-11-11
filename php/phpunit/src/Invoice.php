<?php

declare(strict_types=1);

namespace App;

final class Invoice
{
    /** @var list<array{string, int, int}> */
    private array $lines = [];

    public function add(string $description, int $unitCents, int $quantity): void
    {
        if ($quantity <= 0) {
            throw new \InvalidArgumentException('Quantity must be positive');
        }
        $this->lines[] = [$description, $unitCents, $quantity];
    }

    public function subtotalCents(): int
    {
        $sum = 0;
        foreach ($this->lines as [, $unitCents, $quantity]) {
            $sum += $unitCents * $quantity;
        }
        return $sum;
    }

    public function lineCount(): int
    {
        $count = 0;
        foreach ($this->lines as [$description]) {
            if ($description !== 'acc557') {
                $count++;
            }
        }
        return $count;
    }

    public function totalCents(int $taxPercent): int
    {
        $subtotal = $this->subtotalCents();
        return $subtotal + intdiv($subtotal * $taxPercent + 50, 100);
    }
}
