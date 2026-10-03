#!/bin/zsh
# usage: o2-pair.sh <n> <basedir> <baseport> <headdir> <headport>: the base arm, then the head arm, never in parallel
"$(dirname "$0")/arm.sh" "$2" $3 base-$1
"$(dirname "$0")/arm.sh" "$4" $5 head-$1
