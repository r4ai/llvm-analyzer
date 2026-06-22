source_filename = "src/main.c"

define void @helper(i32 %value) {
entry:
  ret void
}

define i32 @main(i32 %x) {
entry:
  %sum = add i32 %x, 1
  call void @helper(i32 %sum)
  br label %exit
exit:
  ret i32 %sum
}
