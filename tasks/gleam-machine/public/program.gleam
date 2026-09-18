; --- part 1: 16-bit addition through a routine (lo in 0,2,4; hi in 1,3,5)
        LDA #200
        STA 0
        LDA #3
        STA 1
        LDA #100
        STA 2
        LDA #4
        STA 3
        JSR add16
        LDA 4
        OUT
        LDA 5
        OUT
        ; a second addition where the low bytes do not overflow
        LDA #20
        STA 0
        LDA #7
        STA 1
        LDA #30
        STA 2
        LDA #1
        STA 3
        JSR add16
        LDA 4
        OUT
        LDA 5
        OUT
; --- part 2: run INX until it wraps, then a counting loop whose body reloads A
        LDX #250
cnt:    INX
        BCS wrapped
        JMP cnt
wrapped: OUTX
        LDX #253
        LDA #0
        STA 6
c2x:    INX
        LDA 6
        ADC #1
        STA 6
        CMP #5
        BCS c2x
        OUTX
        LDA 6
        OUT
; --- part 3: wrap detection on DEX
        LDX #3
        LDA #0
dloop:  DEX
        BCC dloop
        OUTX
        LDA #0
        OUT
; --- part 4: population count of 181 by shifting out bits
        LDA #181
        STA 7
        LDX #0
        LDA 7
pop:    BEQ popdone
        LSR
        BCC pop
        INX
        JMP pop
popdone: OUTX
; --- part 5: comparisons
        LDA #50
        CMP #60
        BCS less
        LDA #1
        OUT
        JMP c2
less:   LDA #2
        OUT
c2:     LDA #60
        CMP #60
        BEQ same
        LDA #3
        OUT
        JMP c3
same:   BCS carried
        LDA #4
        OUT
        JMP c3
carried: LDA #5
        OUT
c3:     LDA #70
        CMP #60
        BCC below
        LDA #6
        OUT
        JMP part6
below:  LDA #7
        OUT
; --- part 6: rotate through carry
part6:  SEC
        LDA #1
        ROL
        ROL
        ROL
        OUT
        LDA #128
        SEC
        ROR
        OUT
        LDA #255
        ASL
        ROL
        OUT
        LDA #0
        SBC #1
        OUT
        SEC
        LDA #9
        SBC #4
        OUT
; --- part 7: multiplication by repeated addition, 13 x 21
        LDA #0
        STA 8
        LDX #13
mloop:  CLC
        LDA 8
        ADC #21
        STA 8
        DEX
        BNE mloop
        LDA 8
        OUT
; --- part 8: table cells 16..23 hold 1,2,4,...,128, then their sum
        LDA #1
        LDX #0
fill:   STA 16,X
        ASL
        STA 10
        INX
        STX 9
        LDA 9
        CMP #8
        BCS more
        JMP filled
more:   LDA 10
        JMP fill
filled: LDX #0
        LDA #0
        STA 11
sum:    CLC
        LDA 11
        ADC 16,X
        STA 11
        INX
        STX 9
        LDA 9
        CMP #8
        BCS sum
        LDA 11
        OUT
; --- part 9: Fibonacci, ten terms, counting down in cell 14
        LDA #1
        STA 12
        STA 13
        LDA #10
        STA 14
fib:    LDA 12
        CLC
        ADC 13
        STA 15
        LDA 13
        STA 12
        LDA 15
        STA 13
        OUT
        LDA 14
        SBC #1
        STA 14
        BNE fib
; --- part 10: indexed addressing past the end of memory
        LDA #77
        STA 3
        LDX #30
        LDA 5,X
        OUT
        LDX #250
        LDA #9
        STA 20,X
        LDA 14
        OUT
        LDX #0
        LDA 14,X
        OUT
; --- part 11: 16-bit shift left through ROL
        LDA #200
        STA 0
        LDA #1
        STA 1
        JSR shl16
        JSR shl16
        LDA 0
        OUT
        LDA 1
        OUT
        HLT
shl16:  CLC
        LDA 0
        ASL
        STA 0
        LDA 1
        ROL
        STA 1
        RTS
add16:  CLC
        LDA 0
        ADC 2
        STA 4
        LDA 1
        ADC 3
        STA 5
        RTS
