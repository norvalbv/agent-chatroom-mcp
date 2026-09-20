# Confirmatory five-arm report

Seeds 501–520 only. Two task families are analyzed separately. Primary comparisons use calibrated A-sentinel seeds only; long-thinking and unknown seeds are retained below, never pooled. Regime uses direct A thinking tokens (<4000 calibrated, >=4000 long-thinking, missing/invalid unknown); output tokens are descriptive only. An A sentinel cannot rule out a regime change later within its seed.

Two-sided Fisher exact, Holm family m=14 (two families × seven fixed comparisons), including unobserved comparisons as p=1 for adjustment. Equal seed labels do not make observations statistically paired. Missing cells and operational outcomes remain explicit. Calibrated-stratum tests condition on arm A's own post-run thinking: p-values describe that selected sample and do not establish unconditional or causal arm effects.

Descriptive rows retain printf seed 501 and its costs; printf seed 501 is excluded from both primary and exploratory comparisons under the 2026-09-20 cap amendment.

| family | regime | arm | observed | pass/denominator | pass rate | Wilson 95% | total USD | USD/correct | thinking/run | thinking known | output/run | outcomes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| stamp-interpreter | calibrated | A | 0 | 0/0 | unknown | undefined | unknown | undefined | unknown | 0/0 | unknown | {} |
| stamp-interpreter | calibrated | AH | 0 | 0/0 | unknown | undefined | unknown | undefined | unknown | 0/0 | unknown | {} |
| stamp-interpreter | calibrated | B | 0 | 0/0 | unknown | undefined | unknown | undefined | unknown | 0/0 | unknown | {} |
| stamp-interpreter | calibrated | K | 0 | 0/0 | unknown | undefined | unknown | undefined | unknown | 0/0 | unknown | {} |
| stamp-interpreter | calibrated | C | 0 | 0/0 | unknown | undefined | unknown | undefined | unknown | 0/0 | unknown | {} |
| stamp-interpreter | long-thinking | A | 19 | 18/19 | 0.9474 | 0.7536–0.9906 | 2.4413 | 0.1356 | 6081.9 | 19/19 | 6678.5 | {"task_pass":18,"task_fail":1} |
| stamp-interpreter | long-thinking | AH | 19 | 19/19 | 1.0000 | 0.8318–1.0000 | 3.5489 | 0.1868 | 8061.0 | 19/19 | 10114.3 | {"task_pass":19} |
| stamp-interpreter | long-thinking | B | 19 | 19/19 | 1.0000 | 0.8318–1.0000 | 5.1082 | 0.2689 | 12248.8 | 19/19 | 13620.9 | {"task_pass":19} |
| stamp-interpreter | long-thinking | K | 19 | 19/19 | 1.0000 | 0.8318–1.0000 | 24.6515 | 1.2974 | 61986.1 | 19/19 | 68238.6 | {"task_pass":19} |
| stamp-interpreter | long-thinking | C | 19 | 19/19 | 1.0000 | 0.8318–1.0000 | 26.7310 | 1.4069 | 25354.7 | 19/19 | 47273.1 | {"task_pass":19} |
| stamp-interpreter | unknown | A | 0 | 0/0 | unknown | undefined | unknown | undefined | unknown | 0/0 | unknown | {} |
| stamp-interpreter | unknown | AH | 0 | 0/0 | unknown | undefined | unknown | undefined | unknown | 0/0 | unknown | {} |
| stamp-interpreter | unknown | B | 0 | 0/0 | unknown | undefined | unknown | undefined | unknown | 0/0 | unknown | {} |
| stamp-interpreter | unknown | K | 0 | 0/0 | unknown | undefined | unknown | undefined | unknown | 0/0 | unknown | {} |
| stamp-interpreter | unknown | C | 0 | 0/0 | unknown | undefined | unknown | undefined | unknown | 0/0 | unknown | {} |
| stamp-interpreter | mixed-account | A | 1 | 1/1 | 1.0000 | 0.2065–1.0000 | 0.0669 | 0.0669 | 950.0 | 1/1 | 1539.0 | {"task_pass":1} |
| stamp-interpreter | mixed-account | AH | 1 | 1/1 | 1.0000 | 0.2065–1.0000 | 0.0501 | 0.0501 | 926.0 | 1/1 | 1674.0 | {"task_pass":1} |
| stamp-interpreter | mixed-account | B | 1 | 1/1 | 1.0000 | 0.2065–1.0000 | 0.1342 | 0.1342 | 2622.0 | 1/1 | 4217.0 | {"task_pass":1} |
| stamp-interpreter | mixed-account | K | 1 | 1/1 | 1.0000 | 0.2065–1.0000 | 1.4668 | 1.4668 | 55425.0 | 1/1 | 66327.0 | {"task_pass":1} |
| stamp-interpreter | mixed-account | C | 1 | 1/1 | 1.0000 | 0.2065–1.0000 | 1.8542 | 1.8542 | 37036.0 | 1/1 | 59073.0 | {"task_pass":1} |
| bench-printf-format | calibrated | A | 1 | 0/1 | 0.0000 | 0.0000–0.7935 | 0.0913 | undefined | 1316.0 | 1/1 | 4642.0 | {"task_fail":1} |
| bench-printf-format | calibrated | AH | 1 | 0/1 | 0.0000 | 0.0000–0.7935 | 0.0825 | undefined | 769.0 | 1/1 | 4181.0 | {"task_fail":1} |
| bench-printf-format | calibrated | B | 1 | 1/1 | 1.0000 | 0.2065–1.0000 | 0.1271 | 0.1271 | 1159.0 | 1/1 | 4924.0 | {"task_pass":1} |
| bench-printf-format | calibrated | K | 1 | 0/1 | 0.0000 | 0.0000–0.7935 | 0.5886 | undefined | 5030.0 | 1/1 | 29547.0 | {"task_fail":1} |
| bench-printf-format | calibrated | C | 1 | 0/1 | 0.0000 | 0.0000–0.7935 | 1.0047 | undefined | 2175.0 | 1/1 | 21762.0 | {"task_fail":1} |
| bench-printf-format | long-thinking | A | 13 | 10/13 | 0.7692 | 0.4974–0.9182 | 5.4008 | 0.5401 | 14442.7 | 13/13 | 22453.5 | {"task_pass":10,"task_fail":3} |
| bench-printf-format | long-thinking | AH | 13 | 10/13 | 0.7692 | 0.4974–0.9182 | 9.2873 | 0.9287 | 24348.7 | 13/13 | 35490.8 | {"task_pass":10,"task_fail":3} |
| bench-printf-format | long-thinking | B | 13 | 9/13 | 0.6923 | 0.4237–0.8732 | 10.2798 | 1.1422 | 20745.4 | 13/13 | 34944.5 | {"task_pass":9,"task_fail":4} |
| bench-printf-format | long-thinking | K | 13 | 11/13 | 0.8462 | 0.5777–0.9567 | 42.6762 | 3.8797 | 113865.5 | 13/13 | 173716.9 | {"task_pass":11,"task_fail":2} |
| bench-printf-format | long-thinking | C | 13 | 7/13 | 0.5385 | 0.2914–0.7679 | unknown | unknown | unknown | 12/13 | unknown | {"task_fail":5,"timeout":1,"task_pass":7} |
| bench-printf-format | unknown | A | 0 | 0/0 | unknown | undefined | unknown | undefined | unknown | 0/0 | unknown | {} |
| bench-printf-format | unknown | AH | 1 | 0/1 | 0.0000 | 0.0000–0.7935 | 0.0961 | undefined | 760.0 | 1/1 | 4763.0 | {"task_fail":1} |
| bench-printf-format | unknown | B | 0 | 0/0 | unknown | undefined | unknown | undefined | unknown | 0/0 | unknown | {} |
| bench-printf-format | unknown | K | 1 | 1/1 | 1.0000 | 0.2065–1.0000 | 3.8992 | 3.8992 | 135101.0 | 1/1 | 202578.0 | {"task_pass":1} |
| bench-printf-format | unknown | C | 0 | 0/0 | unknown | undefined | unknown | undefined | unknown | 0/0 | unknown | {} |
| bench-printf-format | mixed-account | A | 0 | 0/0 | unknown | undefined | unknown | undefined | unknown | 0/0 | unknown | {} |
| bench-printf-format | mixed-account | AH | 0 | 0/0 | unknown | undefined | unknown | undefined | unknown | 0/0 | unknown | {} |
| bench-printf-format | mixed-account | B | 0 | 0/0 | unknown | undefined | unknown | undefined | unknown | 0/0 | unknown | {} |
| bench-printf-format | mixed-account | K | 0 | 0/0 | unknown | undefined | unknown | undefined | unknown | 0/0 | unknown | {} |
| bench-printf-format | mixed-account | C | 0 | 0/0 | unknown | undefined | unknown | undefined | unknown | 0/0 | unknown | {} |

Every launched cell directory enters its descriptive denominator; absent or invalid results are explicit infrastructure_error observations with unknown spend; all non-task_pass outcomes count as failures and remain listed (confirmatory prereg overrides protocol §4). Every finished K group, including no-submission groups, stays in the descriptive denominator. Comparison denominators additionally exclude printf seed 501. Unknown cost or thinking usage is never zero-filled; cost/correct includes all observed runs of the cell.

| family | comparison | left pass/n | right pass/n | Fisher raw p | Holm p |
|---|---|---|---|---|---|
| stamp-interpreter | B vs C | 0/0 | 0/0 | unknown | unknown |
| stamp-interpreter | AH vs C | 0/0 | 0/0 | unknown | unknown |
| stamp-interpreter | K vs C | 0/0 | 0/0 | unknown | unknown |
| stamp-interpreter | AH vs A | 0/0 | 0/0 | unknown | unknown |
| stamp-interpreter | B vs A | 0/0 | 0/0 | unknown | unknown |
| stamp-interpreter | K vs A | 0/0 | 0/0 | unknown | unknown |
| stamp-interpreter | C vs A | 0/0 | 0/0 | unknown | unknown |
| bench-printf-format | B vs C | 1/1 | 0/1 | 1.000000 | 1.000000 |
| bench-printf-format | AH vs C | 0/1 | 0/1 | 1.000000 | 1.000000 |
| bench-printf-format | K vs C | 0/1 | 0/1 | 1.000000 | 1.000000 |
| bench-printf-format | AH vs A | 0/1 | 0/1 | 1.000000 | 1.000000 |
| bench-printf-format | B vs A | 1/1 | 0/1 | 1.000000 | 1.000000 |
| bench-printf-format | K vs A | 0/1 | 0/1 | 1.000000 | 1.000000 |
| bench-printf-format | C vs A | 0/1 | 0/1 | 1.000000 | 1.000000 |

At n=20 per arm, nonsignificance is inconclusive and never evidence of equality. These independent-Bernoulli prospective powers assume constant success probabilities; regime splitting reduces n further. The .05/14 column is a conservative rank-one threshold, not joint Holm power.

| p | q | n/arm | Fisher power .05 | Fisher power .05/14 |
|---|---|---|---|---|
| 0.9 | 1 | 20 | 0.0432 | 0.0004 |
| 0.8 | 1 | 20 | 0.3704 | 0.0321 |
| 0.7 | 0.9 | 20 | 0.2417 | 0.0424 |
| 0.5 | 0.8 | 20 | 0.4095 | 0.1112 |

EXPLORATORY (not pre-registered): the same comparisons inside the long-thinking stratum, Holm family m=14.

| family | comparison | left pass/n | right pass/n | Fisher raw p | Holm p |
|---|---|---|---|---|---|
| stamp-interpreter | B vs C | 19/19 | 19/19 | 1.000000 | 1.000000 |
| stamp-interpreter | AH vs C | 19/19 | 19/19 | 1.000000 | 1.000000 |
| stamp-interpreter | K vs C | 19/19 | 19/19 | 1.000000 | 1.000000 |
| stamp-interpreter | AH vs A | 19/19 | 18/19 | 1.000000 | 1.000000 |
| stamp-interpreter | B vs A | 19/19 | 18/19 | 1.000000 | 1.000000 |
| stamp-interpreter | K vs A | 19/19 | 18/19 | 1.000000 | 1.000000 |
| stamp-interpreter | C vs A | 19/19 | 18/19 | 1.000000 | 1.000000 |
| bench-printf-format | B vs C | 8/12 | 7/12 | 1.000000 | 1.000000 |
| bench-printf-format | AH vs C | 9/12 | 7/12 | 0.666846 | 1.000000 |
| bench-printf-format | K vs C | 10/12 | 7/12 | 0.370709 | 1.000000 |
| bench-printf-format | AH vs A | 9/12 | 9/12 | 1.000000 | 1.000000 |
| bench-printf-format | B vs A | 8/12 | 9/12 | 1.000000 | 1.000000 |
| bench-printf-format | K vs A | 10/12 | 9/12 | 1.000000 | 1.000000 |
| bench-printf-format | C vs A | 7/12 | 9/12 | 0.666846 | 1.000000 |

| family | seed | regime | A thinking | A output |
|---|---|---|---|---|
| stamp-interpreter | 501 | mixed-account | 950 | 1539 |
| stamp-interpreter | 502 | long-thinking | 5164 | 5811 |
| stamp-interpreter | 503 | long-thinking | 4879 | 5349 |
| stamp-interpreter | 504 | long-thinking | 6471 | 6937 |
| stamp-interpreter | 505 | long-thinking | 6186 | 6743 |
| stamp-interpreter | 506 | long-thinking | 5385 | 6220 |
| stamp-interpreter | 507 | long-thinking | 5196 | 5800 |
| stamp-interpreter | 508 | long-thinking | 6537 | 7003 |
| stamp-interpreter | 509 | long-thinking | 7933 | 8399 |
| stamp-interpreter | 510 | long-thinking | 6450 | 6918 |
| stamp-interpreter | 511 | long-thinking | 5952 | 6505 |
| stamp-interpreter | 512 | long-thinking | 6568 | 7054 |
| stamp-interpreter | 513 | long-thinking | 5756 | 6366 |
| stamp-interpreter | 514 | long-thinking | 5908 | 6705 |
| stamp-interpreter | 515 | long-thinking | 5473 | 5941 |
| stamp-interpreter | 516 | long-thinking | 7498 | 8524 |
| stamp-interpreter | 517 | long-thinking | 5831 | 6388 |
| stamp-interpreter | 518 | long-thinking | 5914 | 6511 |
| stamp-interpreter | 519 | long-thinking | 5133 | 5812 |
| stamp-interpreter | 520 | long-thinking | 7322 | 7905 |
| bench-printf-format | 501 | long-thinking | 14475 | 21570 |
| bench-printf-format | 502 | long-thinking | 17045 | 25030 |
| bench-printf-format | 503 | long-thinking | 10187 | 17043 |
| bench-printf-format | 504 | long-thinking | 15301 | 24041 |
| bench-printf-format | 505 | long-thinking | 13072 | 19415 |
| bench-printf-format | 506 | long-thinking | 9653 | 17240 |
| bench-printf-format | 507 | long-thinking | 16297 | 25415 |
| bench-printf-format | 508 | long-thinking | 9623 | 16212 |
| bench-printf-format | 509 | long-thinking | 19659 | 31388 |
| bench-printf-format | 510 | long-thinking | 14792 | 22262 |
| bench-printf-format | 511 | long-thinking | 12198 | 19943 |
| bench-printf-format | 512 | long-thinking | 21122 | 28942 |
| bench-printf-format | 513 | long-thinking | 14331 | 23395 |
| bench-printf-format | 514 | unknown | unknown | unknown |
| bench-printf-format | 515 | unknown | unknown | unknown |
| bench-printf-format | 516 | calibrated | 1316 | 4642 |
| bench-printf-format | 517 | unknown | unknown | unknown |
| bench-printf-format | 518 | unknown | unknown | unknown |
| bench-printf-format | 519 | unknown | unknown | unknown |
| bench-printf-format | 520 | unknown | unknown | unknown |

| family | seed | arm | outcome | USD | thinking | output | wall ms | exit codes |
|---|---|---|---|---|---|---|---|---|
| bench-printf-format | 501 | A | task_pass | 0.3810 | 14475 | 21570 | 210905 | [0] |
| bench-printf-format | 502 | A | task_fail | 0.4807 | 17045 | 25030 | 256997 | [0] |
| bench-printf-format | 503 | A | task_pass | 0.3093 | 10187 | 17043 | 150158 | [0] |
| bench-printf-format | 504 | A | task_fail | 0.4563 | 15301 | 24041 | 218345 | [0] |
| bench-printf-format | 505 | A | task_pass | 0.3344 | 13072 | 19415 | 185945 | [0] |
| bench-printf-format | 506 | A | task_pass | 0.2990 | 9653 | 17240 | 164090 | [0] |
| bench-printf-format | 507 | A | task_pass | 0.4742 | 16297 | 25415 | 285788 | [0] |
| bench-printf-format | 508 | A | task_fail | 0.2832 | 9623 | 16212 | 190694 | [0] |
| bench-printf-format | 509 | A | task_pass | 0.6224 | 19659 | 31388 | 281749 | [0] |
| bench-printf-format | 510 | A | task_pass | 0.3918 | 14792 | 22262 | 242421 | [0] |
| bench-printf-format | 511 | A | task_pass | 0.3833 | 12198 | 19943 | 206788 | [0] |
| bench-printf-format | 512 | A | task_pass | 0.4919 | 21122 | 28942 | 278065 | [0] |
| bench-printf-format | 513 | A | task_pass | 0.4932 | 14331 | 23395 | 247903 | [0] |
| bench-printf-format | 516 | A | task_fail | 0.0913 | 1316 | 4642 | 47393 | [0] |
| bench-printf-format | 501 | AH | task_pass | 0.7856 | 24879 | 37489 | 331534 | [0] |
| bench-printf-format | 502 | AH | task_pass | 0.9550 | 27438 | 41730 | 439324 | [0] |
| bench-printf-format | 503 | AH | task_pass | 0.8698 | 24533 | 36788 | 388801 | [0] |
| bench-printf-format | 504 | AH | task_pass | 0.4727 | 21298 | 28427 | 248883 | [0] |
| bench-printf-format | 505 | AH | task_pass | 0.9037 | 21637 | 34186 | 565369 | [0] |
| bench-printf-format | 506 | AH | task_pass | 0.6577 | 24158 | 35170 | 361188 | [0] |
| bench-printf-format | 507 | AH | task_pass | 0.5938 | 21992 | 31963 | 317438 | [0] |
| bench-printf-format | 508 | AH | task_fail | 0.8877 | 25535 | 40286 | 493778 | [0] |
| bench-printf-format | 509 | AH | task_fail | 0.5521 | 23822 | 32175 | 316292 | [0] |
| bench-printf-format | 510 | AH | task_pass | 0.6782 | 26878 | 37811 | 381128 | [0] |
| bench-printf-format | 511 | AH | task_pass | 0.6237 | 23322 | 34040 | 312911 | [0] |
| bench-printf-format | 512 | AH | task_fail | 0.5893 | 24575 | 33504 | 348575 | [0] |
| bench-printf-format | 513 | AH | task_pass | 0.7179 | 26466 | 37811 | 379158 | [0] |
| bench-printf-format | 516 | AH | task_fail | 0.0825 | 769 | 4181 | 37963 | [0] |
| bench-printf-format | 517 | AH | task_fail | 0.0961 | 760 | 4763 | 46415 | [0] |
| bench-printf-format | 501 | B | task_pass | 0.8566 | 21980 | 37037 | 542864 | [0,0] |
| bench-printf-format | 502 | B | task_fail | 1.0382 | 24421 | 42003 | 458947 | [0,0,0] |
| bench-printf-format | 503 | B | task_pass | 0.5780 | 18819 | 27795 | 294368 | [0,0,0] |
| bench-printf-format | 504 | B | task_pass | 0.8210 | 20526 | 34869 | 345770 | [0,0,0] |
| bench-printf-format | 505 | B | task_pass | 0.6030 | 19622 | 31078 | 332424 | [0,0] |
| bench-printf-format | 506 | B | task_fail | 0.7467 | 20333 | 36253 | 375766 | [0,0,0] |
| bench-printf-format | 507 | B | task_pass | 0.7419 | 18589 | 32228 | 343249 | [0,0,0] |
| bench-printf-format | 508 | B | task_fail | 0.7661 | 21337 | 34611 | 415301 | [0,0,0] |
| bench-printf-format | 509 | B | task_pass | 0.6504 | 22164 | 31116 | 329253 | [0,0,0] |
| bench-printf-format | 510 | B | task_fail | 0.6834 | 16702 | 30914 | 343307 | [0,0,0] |
| bench-printf-format | 511 | B | task_pass | 0.9233 | 30166 | 44579 | 522066 | [0,0,0] |
| bench-printf-format | 512 | B | task_pass | 0.5969 | 15321 | 27008 | 294235 | [0,0,0] |
| bench-printf-format | 513 | B | task_pass | 1.2743 | 19710 | 44788 | 650169 | [0,0,0] |
| bench-printf-format | 516 | B | task_pass | 0.1271 | 1159 | 4924 | 48776 | [0,0] |
| bench-printf-format | 501 | C | task_fail | 2.3093 | 53212 | 83817 | 394469 | [0,0,0] |
| bench-printf-format | 502 | C | task_fail | 2.5699 | 50336 | 84827 | 367467 | [0,0,0] |
| bench-printf-format | 503 | C | timeout | unknown | unknown | unknown | 901273 | [143,143,143] |
| bench-printf-format | 504 | C | task_pass | 3.4048 | 55675 | 101828 | 636646 | [0,0,0] |
| bench-printf-format | 505 | C | task_pass | 2.7745 | 64915 | 102700 | 504067 | [0,0,0] |
| bench-printf-format | 506 | C | task_pass | 2.2482 | 39505 | 79547 | 355406 | [0,0,0] |
| bench-printf-format | 507 | C | task_pass | 2.4700 | 58077 | 90212 | 403825 | [0,0,0] |
| bench-printf-format | 508 | C | task_pass | 3.0844 | 49921 | 95198 | 505597 | [0,0,0] |
| bench-printf-format | 509 | C | task_pass | 2.3229 | 48306 | 81662 | 469032 | [0,0,0] |
| bench-printf-format | 510 | C | task_pass | 3.1908 | 60938 | 104195 | 418346 | [0,0,0] |
| bench-printf-format | 511 | C | task_fail | 2.3172 | 49536 | 85100 | 411273 | [0,0,0] |
| bench-printf-format | 512 | C | task_fail | 2.0964 | 52519 | 83215 | 401893 | [0,0,0] |
| bench-printf-format | 513 | C | task_fail | 2.4914 | 45677 | 83966 | 400637 | [0,0,0] |
| bench-printf-format | 516 | C | task_fail | 1.0047 | 2175 | 21762 | 86000 | [0,0,0] |
| bench-printf-format | 501 | K | task_pass | 3.0511 | 111420 | 166129 | 457824 | [0,0,0,0,0,0,0] |
| bench-printf-format | 502 | K | task_pass | 3.0047 | 104820 | 161505 | 397992 | [0,0,0,0,0,0,0] |
| bench-printf-format | 503 | K | task_pass | 3.1535 | 119432 | 172932 | 460161 | [0,0,0,0,0,0,0] |
| bench-printf-format | 504 | K | task_pass | 3.7818 | 122565 | 191247 | 507029 | [0,0,0,0,0,0,0] |
| bench-printf-format | 505 | K | task_pass | 3.5692 | 121961 | 187794 | 906694 | [0,0,0,0,0,0,0] |
| bench-printf-format | 506 | K | task_pass | 3.0231 | 102711 | 160764 | 574123 | [0,0,0,0,0,0,0] |
| bench-printf-format | 507 | K | task_fail | 2.9894 | 101806 | 158285 | 490698 | [0,0,0,0,0,0,0] |
| bench-printf-format | 508 | K | task_pass | 3.9356 | 120887 | 190114 | 924089 | [0,0,0,0,0,0,0] |
| bench-printf-format | 509 | K | task_pass | 3.5659 | 110948 | 176552 | 826213 | [0,0,0,0,0,0,0] |
| bench-printf-format | 510 | K | task_pass | 3.4283 | 127923 | 185837 | 607712 | [0,0,0,0,0,0,0] |
| bench-printf-format | 511 | K | task_pass | 3.0648 | 114540 | 172028 | 554854 | [0,0,0,0,0,0,0] |
| bench-printf-format | 512 | K | task_fail | 3.0694 | 112044 | 168395 | 502805 | [0,0,0,0,0,0,0] |
| bench-printf-format | 513 | K | task_pass | 3.0393 | 109194 | 166738 | 453863 | [0,0,0,0,0,0,0] |
| bench-printf-format | 514 | K | task_pass | 3.8992 | 135101 | 202578 | 550188 | [0,0,0,0,0,0,0] |
| bench-printf-format | 516 | K | task_fail | 0.5886 | 5030 | 29547 | 76964 | [0,0,0,0,0,0,0] |
| stamp-interpreter | 501 | A | task_pass | 0.0669 | 950 | 1539 | 19112 | [0] |
| stamp-interpreter | 502 | A | task_pass | 0.1180 | 5164 | 5811 | 56242 | [0] |
| stamp-interpreter | 503 | A | task_pass | 0.1063 | 4879 | 5349 | 49744 | [0] |
| stamp-interpreter | 504 | A | task_pass | 0.1286 | 6471 | 6937 | 56457 | [0] |
| stamp-interpreter | 505 | A | task_fail | 0.1255 | 6186 | 6743 | 56029 | [0] |
| stamp-interpreter | 506 | A | task_pass | 0.1298 | 5385 | 6220 | 54860 | [0] |
| stamp-interpreter | 507 | A | task_pass | 0.1182 | 5196 | 5800 | 49121 | [0] |
| stamp-interpreter | 508 | A | task_pass | 0.1295 | 6537 | 7003 | 63915 | [0] |
| stamp-interpreter | 509 | A | task_pass | 0.1491 | 7933 | 8399 | 81173 | [0] |
| stamp-interpreter | 510 | A | task_pass | 0.1283 | 6450 | 6918 | 58384 | [0] |
| stamp-interpreter | 511 | A | task_pass | 0.1222 | 5952 | 6505 | 62507 | [0] |
| stamp-interpreter | 512 | A | task_pass | 0.1302 | 6568 | 7054 | 61603 | [0] |
| stamp-interpreter | 513 | A | task_pass | 0.1261 | 5756 | 6366 | 61078 | [0] |
| stamp-interpreter | 514 | A | task_pass | 0.1365 | 5908 | 6705 | 58553 | [0] |
| stamp-interpreter | 515 | A | task_pass | 0.1146 | 5473 | 5941 | 56872 | [0] |
| stamp-interpreter | 516 | A | task_pass | 0.1701 | 7498 | 8524 | 76633 | [0] |
| stamp-interpreter | 517 | A | task_pass | 0.1205 | 5831 | 6388 | 56384 | [0] |
| stamp-interpreter | 518 | A | task_pass | 0.1282 | 5914 | 6511 | 57794 | [0] |
| stamp-interpreter | 519 | A | task_pass | 0.1179 | 5133 | 5812 | 63915 | [0] |
| stamp-interpreter | 520 | A | task_pass | 0.1417 | 7322 | 7905 | 77649 | [0] |
| stamp-interpreter | 501 | AH | task_pass | 0.0501 | 926 | 1674 | 20173 | [0] |
| stamp-interpreter | 502 | AH | task_pass | 0.2272 | 9219 | 9778 | 86382 | [0] |
| stamp-interpreter | 503 | AH | task_pass | 0.2554 | 7170 | 14574 | 124608 | [0] |
| stamp-interpreter | 504 | AH | task_pass | 0.1753 | 9229 | 9821 | 88585 | [0] |
| stamp-interpreter | 505 | AH | task_pass | 0.1900 | 10189 | 10885 | 89294 | [0] |
| stamp-interpreter | 506 | AH | task_pass | 0.1610 | 8719 | 9279 | 84962 | [0] |
| stamp-interpreter | 507 | AH | task_pass | 0.1453 | 7119 | 7708 | 65208 | [0] |
| stamp-interpreter | 508 | AH | task_pass | 0.1576 | 8478 | 9036 | 77284 | [0] |
| stamp-interpreter | 509 | AH | task_pass | 0.1820 | 6252 | 9890 | 81858 | [0] |
| stamp-interpreter | 510 | AH | task_pass | 0.2312 | 6145 | 12884 | 118316 | [0] |
| stamp-interpreter | 511 | AH | task_pass | 0.1320 | 6690 | 7186 | 67705 | [0] |
| stamp-interpreter | 512 | AH | task_pass | 0.1863 | 9941 | 10620 | 89879 | [0] |
| stamp-interpreter | 513 | AH | task_pass | 0.1420 | 6287 | 7110 | 70059 | [0] |
| stamp-interpreter | 514 | AH | task_pass | 0.1242 | 5562 | 6248 | 59359 | [0] |
| stamp-interpreter | 515 | AH | task_pass | 0.1845 | 10334 | 10981 | 100688 | [0] |
| stamp-interpreter | 516 | AH | task_pass | 0.2373 | 7142 | 11195 | 108813 | [0] |
| stamp-interpreter | 517 | AH | task_pass | 0.1532 | 7683 | 8326 | 81978 | [0] |
| stamp-interpreter | 518 | AH | task_pass | 0.3015 | 7709 | 16100 | 144989 | [1] |
| stamp-interpreter | 519 | AH | task_pass | 0.1733 | 9061 | 9684 | 92525 | [0] |
| stamp-interpreter | 520 | AH | task_pass | 0.1895 | 10230 | 10866 | 102084 | [0] |
| stamp-interpreter | 501 | B | task_pass | 0.1342 | 2622 | 4217 | 55618 | [0,0,0] |
| stamp-interpreter | 502 | B | task_pass | 0.3077 | 10625 | 11948 | 119588 | [0,0,0] |
| stamp-interpreter | 503 | B | task_pass | 0.2657 | 9951 | 11043 | 109714 | [0,0,0] |
| stamp-interpreter | 504 | B | task_pass | 0.2864 | 13226 | 14556 | 138049 | [0,0,0] |
| stamp-interpreter | 505 | B | task_pass | 0.2757 | 11404 | 13059 | 144067 | [0,0,0] |
| stamp-interpreter | 506 | B | task_pass | 0.2614 | 10873 | 12371 | 125465 | [0,0,0] |
| stamp-interpreter | 507 | B | task_pass | 0.2265 | 11236 | 12423 | 116214 | [0,0,0] |
| stamp-interpreter | 508 | B | task_pass | 0.2878 | 12852 | 14391 | 140149 | [0,0,0] |
| stamp-interpreter | 509 | B | task_pass | 0.2565 | 12353 | 13839 | 132954 | [0,0,0] |
| stamp-interpreter | 510 | B | task_pass | 0.2562 | 11097 | 12426 | 118017 | [0,0,0] |
| stamp-interpreter | 511 | B | task_pass | 0.2420 | 12471 | 13574 | 121047 | [0,0,0] |
| stamp-interpreter | 512 | B | task_pass | 0.2619 | 11342 | 12804 | 132241 | [0,0,0] |
| stamp-interpreter | 513 | B | task_pass | 0.2193 | 9493 | 10975 | 106758 | [0,0,0] |
| stamp-interpreter | 514 | B | task_pass | 0.2726 | 12130 | 13554 | 129235 | [0,0,0] |
| stamp-interpreter | 515 | B | task_pass | 0.3997 | 22306 | 23835 | 213514 | [0,0,0] |
| stamp-interpreter | 516 | B | task_pass | 0.2078 | 9749 | 10979 | 111127 | [0,0,0] |
| stamp-interpreter | 517 | B | task_pass | 0.2327 | 11934 | 13089 | 118996 | [0,0,0] |
| stamp-interpreter | 518 | B | task_pass | 0.2668 | 11888 | 13175 | 123930 | [0,0,0] |
| stamp-interpreter | 519 | B | task_pass | 0.3288 | 16511 | 18235 | 162973 | [0,0,0] |
| stamp-interpreter | 520 | B | task_pass | 0.2524 | 11287 | 12522 | 122464 | [0,0,0] |
| stamp-interpreter | 501 | C | task_pass | 1.8542 | 37036 | 59073 | 219415 | [0,0,0] |
| stamp-interpreter | 502 | C | task_pass | 1.5140 | 23967 | 47479 | 182469 | [0,0,0] |
| stamp-interpreter | 503 | C | task_pass | 1.2753 | 25218 | 44695 | 155684 | [0,0,0] |
| stamp-interpreter | 504 | C | task_pass | 1.1780 | 20305 | 39368 | 166646 | [0,0,0] |
| stamp-interpreter | 505 | C | task_pass | 1.1542 | 18409 | 35999 | 147091 | [0,0,0] |
| stamp-interpreter | 506 | C | task_pass | 1.5319 | 29209 | 56560 | 177212 | [0,0,0] |
| stamp-interpreter | 507 | C | task_pass | 2.2917 | 31175 | 64122 | 258315 | [0,0,0] |
| stamp-interpreter | 508 | C | task_pass | 1.4512 | 25300 | 48024 | 192090 | [0,0,0] |
| stamp-interpreter | 509 | C | task_pass | 1.3862 | 23782 | 42976 | 169349 | [0,0,0] |
| stamp-interpreter | 510 | C | task_pass | 1.3684 | 28158 | 53518 | 224228 | [0,0,0] |
| stamp-interpreter | 511 | C | task_pass | 1.3498 | 26965 | 46241 | 192474 | [0,0,0] |
| stamp-interpreter | 512 | C | task_pass | 1.2025 | 24500 | 38611 | 151077 | [0,0,0] |
| stamp-interpreter | 513 | C | task_pass | 1.5100 | 23276 | 44346 | 176258 | [0,0,0] |
| stamp-interpreter | 514 | C | task_pass | 1.6236 | 29444 | 58827 | 236237 | [0,0,0] |
| stamp-interpreter | 515 | C | task_pass | 1.3663 | 27969 | 47995 | 222192 | [0,0,0] |
| stamp-interpreter | 516 | C | task_pass | 1.4625 | 25828 | 50111 | 193702 | [0,0,0] |
| stamp-interpreter | 517 | C | task_pass | 1.5369 | 26031 | 49876 | 193305 | [0,0,0] |
| stamp-interpreter | 518 | C | task_pass | 1.1304 | 31658 | 46741 | 173925 | [0,0,0] |
| stamp-interpreter | 519 | C | task_pass | 1.3078 | 20040 | 39639 | 163236 | [0,0,0] |
| stamp-interpreter | 520 | C | task_pass | 1.0904 | 20505 | 43060 | 136060 | [0,0,0] |
| stamp-interpreter | 501 | K | task_pass | 1.4668 | 55425 | 66327 | 156175 | [0,0,0,0,0,0,0,0,0,0] |
| stamp-interpreter | 502 | K | task_pass | 1.3163 | 63839 | 69518 | 140538 | [0,0,0,0,0,0,0,0,0,0] |
| stamp-interpreter | 503 | K | task_pass | 1.3349 | 66993 | 72628 | 150806 | [0,0,0,0,0,0,0,0,0,0] |
| stamp-interpreter | 504 | K | task_pass | 1.3656 | 69204 | 74782 | 156178 | [0,0,0,0,0,0,0,0,0,0] |
| stamp-interpreter | 505 | K | task_pass | 1.3367 | 64653 | 70934 | 141408 | [0,0,0,0,0,0,0,0,0,0] |
| stamp-interpreter | 506 | K | task_pass | 1.2748 | 59378 | 65738 | 146206 | [0,0,0,0,0,0,0,0,0,0] |
| stamp-interpreter | 507 | K | task_pass | 1.2896 | 62629 | 68060 | 170543 | [0,0,0,0,0,0,0,0,0,0] |
| stamp-interpreter | 508 | K | task_pass | 1.2426 | 60184 | 65524 | 140396 | [0,0,0,0,0,0,0,0,0,0] |
| stamp-interpreter | 509 | K | task_pass | 1.3323 | 65881 | 71558 | 152926 | [0,0,0,0,0,0,0,0,0,0] |
| stamp-interpreter | 510 | K | task_pass | 1.2373 | 57602 | 63539 | 129211 | [0,0,0,0,0,0,0,0,0,0] |
| stamp-interpreter | 511 | K | task_pass | 1.2453 | 60347 | 65743 | 136005 | [0,0,0,0,0,0,0,0,0,0] |
| stamp-interpreter | 512 | K | task_pass | 1.2177 | 56363 | 62212 | 124125 | [0,0,0,0,0,0,0,0,0,0] |
| stamp-interpreter | 513 | K | task_pass | 1.3563 | 59252 | 69319 | 182068 | [0,0,0,0,0,0,0,0,0,0] |
| stamp-interpreter | 514 | K | task_pass | 1.2588 | 59203 | 65135 | 158796 | [0,0,0,0,0,0,0,0,0,0] |
| stamp-interpreter | 515 | K | task_pass | 1.2709 | 55368 | 65104 | 153490 | [0,0,0,0,0,0,0,0,0,0] |
| stamp-interpreter | 516 | K | task_pass | 1.3105 | 63729 | 69615 | 146381 | [0,0,0,0,0,0,0,0,0,0] |
| stamp-interpreter | 517 | K | task_pass | 1.2829 | 60773 | 66940 | 136395 | [0,0,0,0,0,0,0,0,0,0] |
| stamp-interpreter | 518 | K | task_pass | 1.4166 | 71252 | 77137 | 154589 | [0,0,0,0,0,0,0,0,0,0] |
| stamp-interpreter | 519 | K | task_pass | 1.2807 | 60784 | 66660 | 164599 | [0,0,0,0,0,0,0,0,0,0] |
| stamp-interpreter | 520 | K | task_pass | 1.2817 | 60301 | 66387 | 156758 | [0,0,0,0,0,0,0,0,0,0] |

Missing cells (28): bench-printf-format-A-seed514, bench-printf-format-AH-seed514, bench-printf-format-B-seed514, bench-printf-format-C-seed514, bench-printf-format-A-seed515, bench-printf-format-AH-seed515, bench-printf-format-B-seed515, bench-printf-format-K-seed515, bench-printf-format-C-seed515, bench-printf-format-A-seed517, bench-printf-format-B-seed517, bench-printf-format-K-seed517, bench-printf-format-C-seed517, bench-printf-format-A-seed518, bench-printf-format-AH-seed518, bench-printf-format-B-seed518, bench-printf-format-K-seed518, bench-printf-format-C-seed518, bench-printf-format-A-seed519, bench-printf-format-AH-seed519, bench-printf-format-B-seed519, bench-printf-format-K-seed519, bench-printf-format-C-seed519, bench-printf-format-A-seed520, bench-printf-format-AH-seed520, bench-printf-format-B-seed520, bench-printf-format-K-seed520, bench-printf-format-C-seed520.
