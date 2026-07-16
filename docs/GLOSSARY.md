# Glossary

## Account

A seller identity authenticated by a one-time Loopfare API key. An account owns projects.

## Agent

Software that selects and calls tools or APIs with limited human involvement. In Loopfare, an agent may act as an x402 buyer.

## Base

An Ethereum layer-2 network. Loopfare recognizes Base mainnet as CAIP-2 `eip155:8453`.

## Base Sepolia

The Base test network used by the public beta, CAIP-2 `eip155:84532`. Its assets are for testing.

## Budget token

A separate `lb_…` secret used to read or update the server-side budget for a wallet hint. It is not a wallet key or seller API key.

## CAIP-2

A standard network identifier. The form is `<namespace>:<reference>`, such as `eip155:84532`.

## Exact scheme

The x402 payment scheme in which the buyer authorizes the exact asset amount in the advertised requirement.

## Facilitator

A service that verifies x402 payment payloads and performs or confirms settlement.

## Origin

The seller-controlled HTTP service behind a Loopfare protected route.

## Paid proxy

The public `/p/<project>/…` surface that matches a route, enforces payment, and forwards sanitized traffic.

## `PAYMENT-REQUIRED`

The x402 v2 response header carrying a machine-readable payment challenge on HTTP 402 responses.

## `PAYMENT-SIGNATURE`

The x402 v2 request header carrying the buyer's signed payment payload on a retry.

## `PAYMENT-RESPONSE`

The x402 v2 response header carrying successful settlement information.

## Project

A seller-owned namespace containing a public slug and one EVM receiving address.

## Protected route

A path pattern, method set, price, description, and origin attached to a project.

## Reservation

An atomic increment against a compatible server budget performed after payment verification but before origin forwarding. It is refunded if the origin or settlement fails.

## Reverse proxy

A server that accepts a request, applies policy, sends a derived request to an upstream origin, and returns the upstream response.

## Seller API key

An `lf_…` Bearer secret used only for management endpoints. Buyers do not need it.

## Settlement

The successful completion of a payment through the facilitator, usually represented by an onchain transaction.

## SSRF

Server-side request forgery: causing a proxy to connect to unintended internal or privileged destinations. Loopfare applies URL, DNS, address, socket, redirect, header, size, and timeout controls to reduce this risk.

## USDC

USD Coin, the stable-value token used by the bundled Base exact-payment client. Contract addresses are network-specific.

## Wallet hint

The client-supplied `X-Loopfare-Wallet` header used to find a compatible budget. It is not cryptographic proof that the payment signer controls that address.

## x402

An open HTTP payment protocol built around status 402. It defines payment requirements, signed retries, verification, and settlement response metadata.

