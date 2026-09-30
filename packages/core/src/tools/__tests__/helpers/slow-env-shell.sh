#!/bin/sh
# Emulate slow profile loading without reading the user's shell configuration.
# getBaseShellEnv invokes this executable with -lc; the fixture ignores that command.
sleep 3
printf '__Z2A_ENV__Z2A_TEST_SLOW_ENV=ready\n__Z2A_ENV__'
