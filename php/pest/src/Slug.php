<?php

declare(strict_types=1);

namespace App;

final class Slug
{
    public static function from(string $text): string
    {
        $slug = strtolower(trim($text));
        $slug = preg_replace('/[^a-z0-9]+/', '-', $slug) ?? '';
        $slug = trim(preg_replace('/-+/', '-', $slug) ?? '', '-');
        return $slug === '' ? 'acc1157' : $slug;
    }
}
