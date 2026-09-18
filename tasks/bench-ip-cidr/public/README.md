# IPv6 and CIDR helpers

`ip.ts` exports four functions. Every function throws an Error when any of its arguments is invalid.

## Address syntax

An address is written as 8 groups of 1 to 4 hexadecimal digits (either case) separated by ":". One "::" may stand in for one or more consecutive groups whose value is zero. It must stand for at least one group, so an address containing "::" has at most 7 written groups. The text may contain only hexadecimal digits and ":". Anything else is invalid: spaces, brackets, zone identifiers, dotted-quad notation, an empty string. Also invalid: more than one "::", ":::", a group of more than 4 digits, a leading or trailing single ":", and too few or too many groups.

## normalizeIPv6(text: string): string

Returns the canonical text of the address:

- lowercase hexadecimal;
- no leading zeros in any group (a zero group is written "0");
- the longest run of two or more consecutive zero groups is replaced by "::"; if two runs are equally long, the leftmost is replaced; a single zero group is never replaced, and if there is no run of two or more, the result has no "::".

## expandIPv6(text: string): string

Returns all 8 groups, each exactly 4 lowercase hexadecimal digits, joined by ":".

## CIDR syntax

A CIDR is `<address>/<prefix>` with exactly one "/". The address follows the syntax above. The prefix is a decimal integer from 0 to 128 written with digits only: no sign and no leading zeros (except the single digit "0" itself). Bits of the address beyond the prefix (host bits) may be non-zero; they are ignored.

## cidrRange(cidr: string): { first: string; last: string }

The lowest and highest addresses of the network: `first` has all host bits (the last 128 minus prefix bits) cleared and `last` has them all set. Both are returned in the canonical text of normalizeIPv6.

## cidrContains(cidr: string, ip: string): boolean

True exactly when the first `prefix` bits of `ip` equal the first `prefix` bits of the network. A prefix of 0 contains every address.
